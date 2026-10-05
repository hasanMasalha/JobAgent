import asyncio
import os
import random
import re
import tempfile
import time
from urllib.parse import parse_qs, urlsplit

import anthropic
import phonenumbers
import httpx
from playwright.async_api import async_playwright

from application_answers import (
    ApplicantData,
    claude_may_answer,
    is_data_processing_consent,
    is_decline_option,
    match_option,
    user_answer,
)
from captcha_solver import detect_and_solve_captcha
from phone_country import PhoneInfo, match_country_option, parse_phone

_claude_client = anthropic.Anthropic()

_GH_JID_RE = re.compile(r"[?&]gh_jid=(\d+)")
_GH_SLUG_STRIP_LABELS = {"www", "careers", "career", "jobs", "job", "apply"}


async def _resolve_greenhouse_embed_url(apply_url: str) -> str | None:
    """Many companies embed Greenhouse on their own domain instead of using
    boards.greenhouse.io directly — the listing URL then carries Greenhouse's
    gh_jid query param instead of a greenhouse.io hostname (e.g.
    careers.appsflyer.com/jobs/position/8474373002?gh_jid=8474373002). The
    company's own page does NOT contain the Greenhouse form anywhere in its
    HTML in that case — it's injected client-side as a link to Greenhouse's
    own embed page — so driving the company page directly can't work.

    Reconstruct the canonical embed URL instead:
    https://boards.greenhouse.io/embed/job_app?for=<board_token>&token=<gh_jid>
    That page renders the full application form immediately (no 'Apply'
    button to reveal it first, unlike job-boards.greenhouse.io listing
    pages), with the same field IDs (first_name, last_name, email, ...)
    _fill_greenhouse_form already targets.

    The board token isn't in the URL, so it's guessed from the hostname and
    confirmed against Greenhouse's public Boards API before use. Returns the
    embed URL on success, the original URL unchanged if there's no gh_jid to
    resolve, or None if a gh_jid is present but no board token guess could be
    confirmed — callers must treat None as a hard failure, not fall back to
    filling whatever form happens to be on the company's page.
    """
    if "greenhouse.io" in apply_url:
        return apply_url

    match = _GH_JID_RE.search(apply_url)
    if not match:
        return apply_url

    gh_jid = match.group(1)
    host = (urlsplit(apply_url).hostname or "").lower()
    labels = [label for label in host.split(".")[:-1] if label and label not in _GH_SLUG_STRIP_LABELS]

    slug_guesses = []
    if labels:
        slug_guesses.append("".join(labels).replace("-", ""))
        slug_guesses.append("-".join(labels))
    slug_guesses = list(dict.fromkeys(g for g in slug_guesses if g))

    async with httpx.AsyncClient(timeout=10) as client:
        for slug in slug_guesses:
            try:
                resp = await client.get(
                    f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{gh_jid}"
                )
            except Exception as exc:
                print(f"[ats-form] Greenhouse board check failed for {slug!r}: {exc}")
                continue
            if resp.status_code == 200:
                print(f"[ats-form] Resolved embedded Greenhouse board {slug!r} for gh_jid={gh_jid}")
                return f"https://boards.greenhouse.io/embed/job_app?for={slug}&token={gh_jid}"

    print(
        f"[ats-form] Could not confirm Greenhouse board for {apply_url!r} "
        f"(gh_jid={gh_jid}, tried {slug_guesses})"
    )
    return None


def _answer_question(label_text: str, applicant: ApplicantData) -> str | None:
    """The user's own answer to a question, or None (see application_answers:
    facts come only from the user — no defaults). Data-processing consent is
    the one thing answered for them: it's inherent in applying, not a fact."""
    if is_data_processing_consent(label_text):
        return "I agree"
    return user_answer(label_text, applicant)


async def _ask_claude_for_answer(question: str, cv_text: str) -> str | None:
    """Claude's answer to an OPEN-ENDED free-text question ("why this role"),
    grounded in the CV. Only called when application_answers.claude_may_answer
    says so — never for facts, eligibility or legal questions. None on failure."""
    prompt = (
        "You are writing one answer on a job application for a candidate. The "
        "question is open-ended; write a brief, professional answer (2-4 "
        "sentences) grounded only in what the CV below shows. Do not invent "
        "employers, titles, achievements, numbers or experience that aren't in "
        "the CV, and make no claims about eligibility, availability, salary or "
        "location. This is submitted without review under the candidate's "
        "name.\n\n"
        f"Question: {question}\n\n"
        f"CV:\n{(cv_text or '')[:3000]}\n\n"
        "Return ONLY the answer text — no explanation, no quotes, no markdown."
    )
    try:
        message = await asyncio.to_thread(
            _claude_client.messages.create,
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        answer = message.content[0].text.strip()
        print(f"[ats-form] Claude answered open-ended {question!r}")
        return answer[:1500] or None
    except Exception as e:
        print(f"[ats-form] Claude answer failed for {question!r}: {e}")
        return None


# ── Phone country pickers ────────────────────────────────────────────────────
# Greenhouse boards ask for the phone's country in one of three widgets. The
# country comes from the user's own number (phone_country.parse_phone) and an
# option is chosen only when its name and dial code both match
# (match_country_option) — +1 and +44 are shared, so a dial code alone isn't
# enough. Until 2026-10-05 only Israel could be chosen, and the intl-tel-input
# branch set Israel for every number.
#
# Each returns "absent" (no such picker on the form), "set" (chosen and
# confirmed on the page) or "failed".


def _dial_code_is_unique(info: PhoneInfo) -> bool:
    return len(phonenumbers.region_codes_for_country_code(int(info.dial_code.lstrip("+")))) == 1


async def _set_react_select_phone_country(page, info: PhoneInfo | None) -> str:
    """New Greenhouse boards: a react-select inside .phone-input__country."""
    container = page.locator(".phone-input__country").first
    if await container.count() == 0:
        return "absent"
    if info is None:
        return "failed"

    async def confirmed() -> bool:
        # The chip renders a flag div and "+ 44" (space after the plus). The
        # flag class names the country; the chip text alone can't tell the UK
        # from Guernsey, so it only counts for a dial code one country uses.
        if await container.locator(f".iti__{info.region.lower()}").count() > 0:
            return True
        chip = " ".join(await container.locator('[class*="single-value"]').all_inner_texts())
        if match_country_option([chip], info) == 0:
            return True
        return _dial_code_is_unique(info) and info.dial_code.lstrip("+") in re.sub(r"\D", "", chip)

    try:
        # The input itself is a ~3px, opacity-0 hit target on these boards;
        # the visible .select__control is what opens the menu (found on live
        # boards, 2026-05).
        control = container.locator(".select__control").first
        await control.scroll_into_view_if_needed(timeout=3000)
        box = await control.bounding_box()
        if box:
            await page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(300)
        combo = container.locator('input[role="combobox"], #country').first
        if await combo.count() > 0:
            await combo.fill(info.country_name)
        else:
            await page.keyboard.type(info.country_name, delay=30)
        await page.wait_for_timeout(600)

        options = page.get_by_role("option")
        texts = await options.all_inner_texts()
        idx = match_country_option(texts, info)
        print(f"[ats-form] Phone country: {info.country_name} {info.dial_code} → "
              f"option {idx} of {len(texts)} {texts[:6]}")
        if idx == -1:
            await page.keyboard.press("Escape")
            return "failed"
        await options.nth(idx).click(timeout=3000)
        await page.wait_for_timeout(300)
        return "set" if await confirmed() else "failed"
    except Exception as e:
        print(f"[ats-form] Phone country (react-select) error: {e}")
        return "failed"


async def _set_select_phone_country(page, info: PhoneInfo | None) -> str:
    """Old Greenhouse form: a native <select name="phone_country_code">."""
    select = await page.query_selector('select[name="phone_country_code"]')
    if not select:
        return "absent"
    if info is None:
        return "failed"
    try:
        options = await select.evaluate(
            "el => Array.from(el.options).map(o => ({value: o.value, text: o.text.trim()}))"
        )
        idx = next((i for i, o in enumerate(options) if o["value"].upper() == info.region), -1)
        if idx == -1:
            idx = match_country_option([o["text"] for o in options], info)
        if idx == -1:
            return "failed"
        await select.select_option(value=options[idx]["value"])
        chosen = await select.evaluate("el => el.value")
        return "set" if chosen == options[idx]["value"] else "failed"
    except Exception as e:
        print(f"[ats-form] Phone country (select) error: {e}")
        return "failed"


async def _set_iti_phone_country(page, info: PhoneInfo | None) -> str:
    """intl-tel-input (a flag dropdown wrapped around the tel input)."""
    if await page.locator(".iti").count() == 0:
        return "absent"
    if info is None:
        return "failed"
    iso = info.region.lower()
    try:
        # Some builds only register the instance once the input has focus.
        tel = page.locator('#phone, input[type="tel"]').first
        if await tel.count() > 0:
            await tel.click(timeout=3000)
            await page.wait_for_timeout(300)

        selected = await page.evaluate(
            """(iso) => {
                const el = document.querySelector('#phone, input[type="tel"]');
                if (!el) return null;
                const g = window.intlTelInputGlobals;
                let iti = g && g.getInstance && g.getInstance(el);
                if (!iti && g && g.instances) {
                    const keys = Object.keys(g.instances);
                    if (keys.length === 1) iti = g.instances[keys[0]];
                }
                if (!iti && el._iti) iti = el._iti;
                if (!iti) return null;
                iti.setCountry(iso);
                const data = iti.getSelectedCountryData();
                return data ? data.iso2 : null;
            }""",
            iso,
        )
        if selected == iso:
            return "set"

        # No reachable instance: open the flag list and click the country by
        # its data-country-code — unique, so names can't be confused.
        await page.locator(
            "button.iti__selected-country, .iti__selected-flag, .iti__flag-container"
        ).first.click(timeout=3000)
        await page.wait_for_timeout(400)
        item = page.locator(f'.iti__country[data-country-code="{iso}"]').first
        if await item.count() == 0:
            await page.keyboard.press("Escape")
            return "failed"
        await item.click(timeout=3000)
        await page.wait_for_timeout(300)
        shown = page.locator(
            f".iti__selected-country .iti__{iso}, .iti__selected-flag .iti__{iso}"
        )
        return "set" if await shown.count() > 0 else "failed"
    except Exception as e:
        print(f"[ats-form] Phone country (intl-tel-input) error: {e}")
        return "failed"


async def _phone_country_required(page) -> bool:
    """Whether the form marks its phone country picker as required."""
    try:
        return await page.evaluate(
            """() => {
                const label = document.querySelector('label[for="country"]');
                if (label && label.textContent.trim().endsWith('*')) return true;
                const input = document.querySelector('.phone-input__country input, #country');
                return !!input && (input.required || input.getAttribute('aria-required') === 'true');
            }"""
        )
    except Exception:
        return False


def _missing_answers_result(missing: list[str], filled: list[str]) -> dict:
    """Required questions the user hasn't answered: don't submit. The caller
    marks the application needs_manual and refunds the credit."""
    return {
        "success": False,
        "error": "missing_answers",
        "missing": missing,
        "filled": filled,
        "message": "Not submitted — this application asks for answers you haven't given JobAgent: "
        + "; ".join(missing[:6])
        + ". Apply on the employer's site, or save the answers in your Profile.",
    }


async def _human_delay(page, min_ms: int = 50, max_ms: int = 200) -> None:
    await page.wait_for_timeout(random.randint(min_ms, max_ms))


async def _human_click(page, element) -> None:
    """Move mouse to element with slight randomness, then click."""
    try:
        box = await element.bounding_box()
        if box:
            await page.mouse.move(
                box["x"] + box["width"] / 2 + random.randint(-5, 5),
                box["y"] + box["height"] / 2 + random.randint(-5, 5),
            )
            await _human_delay(page, 100, 300)
    except Exception:
        pass
    await element.click()


async def _apply_react_value(page, element, value: str) -> None:
    """Core of the React value-tracker trick, operating on an already-
    resolved ElementHandle. See react_fill for why this is needed instead of
    a plain .fill()/.type().
    """
    await page.evaluate(
        """([element, value]) => {
            const lastValue = element.value;
            element.value = value;
            const tracker = element._valueTracker;
            if (tracker) {
                tracker.setValue(lastValue);
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        [element, value],
    )
    print(f"[ats-form] React-filled: {value[:20]}")


async def react_fill(page, locator, value: str) -> None:
    """Fill a React-controlled input via React's own internal _valueTracker,
    so React detects the change as if the user had typed it.

    React overrides the native <input>.value setter to track state itself.
    Plain assignment (or Playwright's .fill()) updates the DOM but leaves
    React's tracked "last known value" unchanged; when the resulting input
    event fires, React compares element.value against
    _valueTracker.getValue(), sees no difference from its own perspective,
    and skips the state update — so the form looks filled but React (and
    therefore client-side validation on submit) still sees it as empty.
    Calling tracker.setValue(lastValue) first forces a mismatch so React
    processes the change for real. This is an internal React implementation
    detail (not public API) but has been stable since React 15/16.
    """
    element = await locator.element_handle()
    await _apply_react_value(page, element, value)


async def _react_fill(page, selector: str, value: str) -> None:
    """Same as react_fill, but takes a selector string instead of a locator."""
    await react_fill(page, page.locator(selector), value)


async def _type_into_element(page, element, value: str) -> None:
    """Focus an element and type into it via real, per-character keyboard
    events (not .fill()/value-assignment), then Tab away to blur it.

    The _valueTracker trick sets element.value directly — if React
    re-renders that field before we read it back (which a controlled
    component does on every render, always syncing the DOM to its own
    state), a change React never truly registered gets silently wiped back
    to empty. Driving the browser's real input pipeline — keydown/keypress/
    input per character, exactly like a human typing — goes through the
    same path React's own change handling is built to observe, so there's
    no internal tracker state to get out of sync in the first place.
    """
    await element.click()
    await page.wait_for_timeout(200)
    await page.keyboard.press("Control+A")
    await page.keyboard.press("Delete")
    await page.wait_for_timeout(100)
    for char in value:
        await page.keyboard.type(char, delay=50)
    await page.wait_for_timeout(200)
    await page.keyboard.press("Tab")
    await page.wait_for_timeout(200)


async def type_into_field(page, selector: str, value: str) -> None:
    """Same as _type_into_element, but takes a selector string."""
    element = await page.wait_for_selector(selector, timeout=5000)
    await _type_into_element(page, element, value)


async def fill_ats_form(
    apply_url: str,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    cv_bytes: bytes,
    cv_filename: str,
    cover_letter: str,
    linkedin_url: str = "",
    applicant: ApplicantData | None = None,
    cv_text: str = "",
) -> dict:
    """Fill ATS application form using Playwright.

    applicant holds the user's own answers. A required question none of them
    answers stops the application before submit (error "missing_answers").
    """
    applicant = applicant or ApplicantData()

    print("[ats-form] fill_ats_form called")
    print(f"[ats-form] url={apply_url}")
    print(f"[ats-form] cv_bytes length={len(cv_bytes)}")
    print(f"[ats-form] first_name={first_name} last_name={last_name} email={email}")

    resolved_url = await _resolve_greenhouse_embed_url(apply_url)
    if resolved_url is None:
        return {
            "success": False,
            "error": "greenhouse_board_unresolved",
            "message": (
                "This job is hosted on an embedded Greenhouse board we "
                "couldn't confirm automatically — please apply manually."
            ),
        }
    if resolved_url != apply_url:
        print(f"[ats-form] Rewrote embedded Greenhouse URL: {apply_url} -> {resolved_url}")
        apply_url = resolved_url

    # cv_filename's real extension matters here — a passed-through uploaded CV
    # can be a .docx, and uploading it to the ATS form under a .pdf-suffixed
    # temp file would mislabel its type to any client-side validation.
    cv_suffix = os.path.splitext(cv_filename)[1] or ".pdf"
    with tempfile.NamedTemporaryFile(suffix=cv_suffix, delete=False, prefix="cv_") as tmp:
        tmp.write(cv_bytes)
        cv_path = tmp.name

    print(f"[ats-form] CV written to temp file: {cv_path}")

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                # Headed against the container's Xvfb :99 display (see
                # entrypoint.sh) — full Chromium channel alone wasn't enough
                # to render the react-select country portal correctly in
                # headless mode.
                #
                # Kept to just these three flags: --single-process/
                # --no-zygote broke rendering (menuExists: False) and
                # --disable-gpu/--disable-gpu-sandbox/etc. were compensating
                # for a problem that was actually Chromium OOM-crashing
                # without the container's shared memory properly sized —
                # see docker-compose.yml's ipc: host + shm_size on the
                # fastapi service, which is the real fix per
                # https://playwright.dev/docs/docker.
                headless=False,
                args=[
                    "--no-sandbox",  # required to run Chrome at all as root in Docker
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",  # /dev/shm is too small in Docker's default config; use disk instead
                ],
            )

            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                locale="en-US",
                timezone_id="America/New_York",
                device_scale_factor=1,
                has_touch=False,
                color_scheme="light",
            )
            page = await context.new_page()

            # playwright_stealth==1.0.6's stealth_async() was removed: it injects
            # ~16 patches via separate page.add_init_script() calls, but 12 of
            # them reference a shared `opts`/`utils` binding declared in a
            # DIFFERENT add_init_script() call. Its own docstring assumes
            # Playwright combines all init scripts into one shared-scope
            # script — that's not true for the installed Playwright version,
            # so those scripts throw uncaught "opts/utils is not defined"
            # ReferenceErrors the first time anything on the page reads a
            # patched property (e.g. navigator.userAgent). On Greenhouse
            # boards that broke the Country react-select entirely (menu never
            # opened, aria-expanded stuck at "false") since something in its
            # init path reads navigator.userAgent. Confirmed via bisection:
            # disabling just that one property still left the same
            # ReferenceError firing from the other 11 opts/utils-dependent
            # scripts (proven via a stress-check reading every patched
            # property directly) — so this isn't a single bad flag to
            # disable, the library's multi-script injection is broken
            # wholesale under this Playwright version. Only this one-line
            # deletion doesn't depend on opts/utils and is independently
            # confirmed to reliably hide navigator.webdriver on its own.
            await page.add_init_script("delete Object.getPrototypeOf(navigator).webdriver")
            print("[ats-form] navigator.webdriver hidden")

            # Lever job listing URLs need /apply appended to reach the form
            if "lever.co" in apply_url and not apply_url.rstrip("/").endswith("/apply"):
                apply_url = apply_url.rstrip("/") + "/apply"
                print(f"[ats-form] Lever apply URL: {apply_url}")

            print(f"[ats-form] Opening: {apply_url}")
            await page.goto(apply_url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(3000)

            os.makedirs("/app/screenshots", exist_ok=True)
            screenshot_path = f"/app/screenshots/ats_load_{int(time.time())}.png"
            await page.screenshot(path=screenshot_path, full_page=True)
            print(f"[ats-form] Screenshot saved: {screenshot_path}")

            print(f"[ats-form] Current URL after load: {page.url}")

            # Dump all form fields so we know exactly what the form expects
            inputs = await page.query_selector_all("input, textarea, select")
            for inp in inputs:
                name = await inp.get_attribute("name") or ""
                id_ = await inp.get_attribute("id") or ""
                type_ = await inp.get_attribute("type") or ""
                placeholder = await inp.get_attribute("placeholder") or ""
                required = await inp.get_attribute("required")
                print(
                    f"[ats-form] FIELD: name={name} id={id_} type={type_} "
                    f"placeholder={placeholder} required={required}"
                )

            # Modern Greenhouse listing pages (job-boards.greenhouse.io) embed the
            # form but hide it behind an 'Apply' button (type=button, class='btn btn--pill').
            # Clicking it reveals the form INLINE — there is no page navigation.
            # Ignore 'Quick Apply with MyGreenhouse' — it requires a Greenhouse account.
            # /embed/job_app pages (reconstructed from gh_jid, see
            # _resolve_greenhouse_embed_url) render the form directly with no
            # button to click — the "Apply"-text match below would otherwise
            # misfire on that page's "Autofill my application" button.
            if "greenhouse.io" in apply_url and "/embed/job_app" not in apply_url:
                apply_btn = None
                candidates = await page.query_selector_all("button:not([type='submit'])")
                for candidate in candidates:
                    try:
                        text = (await candidate.inner_text()).strip()
                        text_lower = text.lower()
                        if text_lower == "apply" or (
                            "apply" in text_lower
                            and "quick" not in text_lower
                            and "greenhouse" not in text_lower
                            and "job" not in text_lower
                        ):
                            apply_btn = candidate
                            print(f"[ats-form] Greenhouse: found Apply button (text={text!r})")
                            break
                    except Exception:
                        continue

                if apply_btn:
                    await _human_click(page, apply_btn)
                    print("[ats-form] Greenhouse: clicked Apply — waiting for form to reveal...")
                    await page.wait_for_timeout(1000)
                    try:
                        await page.wait_for_selector("#first_name", timeout=10000)
                        print("[ats-form] Greenhouse: form revealed (#first_name visible)")
                    except Exception:
                        print("[ats-form] Greenhouse: WARNING — #first_name not found after Apply click")
                    print(f"[ats-form] Greenhouse: URL after Apply click: {page.url}")
                    # Re-dump fields now that the form is visible
                    inputs2 = await page.query_selector_all("input, textarea, select")
                    for inp in inputs2:
                        name = await inp.get_attribute("name") or ""
                        id_ = await inp.get_attribute("id") or ""
                        type_ = await inp.get_attribute("type") or ""
                        placeholder = await inp.get_attribute("placeholder") or ""
                        required = await inp.get_attribute("required")
                        print(
                            f"[ats-form] FORM-FIELD: name={name} id={id_} type={type_} "
                            f"placeholder={placeholder} required={required}"
                        )
                else:
                    print("[ats-form] Greenhouse: no Apply button found — form should already be visible")

            if "ashbyhq.com" in apply_url:
                # Ashby got the Greenhouse filler until 2026-10-04, which
                # matched none of its fields.
                from ashby_form import fill_ashby_form

                result = await fill_ashby_form(page, apply_url, cv_path, cover_letter, applicant, cv_text)
            elif "lever.co" in apply_url:
                result = await _fill_lever_form(
                    page, first_name, last_name, email, phone, cv_path, cover_letter, linkedin_url,
                    applicant, cv_text,
                )
            else:
                result = await _fill_form_fields(
                    page, first_name, last_name, email, phone, cv_path, cover_letter, linkedin_url,
                    applicant, cv_text,
                )

            await browser.close()
            return result

    finally:
        try:
            os.unlink(cv_path)
        except Exception:
            pass


async def _fill_lever_form(
    page,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    cv_path: str,
    cover_letter: str,
    linkedin_url: str,
    applicant: ApplicantData,
    cv_text: str = "",
) -> dict:
    """Fill Lever-specific application form (lever.co)."""

    filled = []
    full_name = f"{first_name} {last_name}".strip()

    async def _try_fill(selector: str, value: str, field: str) -> bool:
        try:
            el = await page.wait_for_selector(selector, timeout=5000)
            if el:
                await el.fill(value)
                filled.append(field)
                print(f"[ats-form] Lever: filled {field}")
                return True
        except Exception as e:
            print(f"[ats-form] Lever: {field} error: {e}")
        return False

    # Lever uses a single "name" field
    await _try_fill('input[name="name"]', full_name, "name")
    await _try_fill('input[name="email"]', email, "email")
    await _try_fill('input[name="phone"]', phone or "", "phone")

    # Current location — the user's city only. It used to fall back to
    # "Israel" for a user with no city.
    if applicant.city:
        await _try_fill(
            'input[name="location"], input[placeholder*="location" i], input[placeholder*="city" i]',
            applicant.city,
            "location",
        )
    if applicant.current_company:
        await _try_fill('input[name="org"]', applicant.current_company, "current_company")

    # Resume upload
    try:
        el = await page.wait_for_selector('input[type="file"]', timeout=3000)
        if el:
            await el.set_input_files(cv_path)
            filled.append("resume")
            print("[ats-form] Lever: uploaded resume")
    except Exception as e:
        print(f"[ats-form] Lever: resume upload error: {e}")

    # LinkedIn URL
    if linkedin_url:
        try:
            el = await page.query_selector('input[name="urls[LinkedIn]"]')
            if el:
                await el.fill(linkedin_url)
                filled.append("linkedin")
                print("[ats-form] Lever: filled linkedin")
        except Exception:
            pass

    # Cover letter in comments / org field
    try:
        el = await page.query_selector(
            'textarea[name="comments"], '
            'textarea[placeholder*="cover"], '
            'textarea[placeholder*="Cover"]'
        )
        if el:
            await el.fill(cover_letter)
            filled.append("cover_letter")
            print("[ats-form] Lever: filled cover letter")
    except Exception:
        pass

    # Custom questions and surveys. Until 2026-10-04 every dropdown here was
    # set to "No" (e.g. "Are you a current SAP employee?") or its first
    # option, and custom radio / checkbox / text questions weren't answered.
    missing = await _fill_lever_questions(page, applicant, cv_text, filled)
    if missing:
        print(f"[ats-form] Lever: not submitting, no answer from the user for: {missing}")
        return _missing_answers_result(missing, filled)

    # Check for hCaptcha before attempting submit
    hcaptcha = await page.query_selector(
        'input[name="h-captcha-response"], .h-captcha, iframe[src*="hcaptcha"]'
    )
    if hcaptcha:
        print("[ats-form] hCaptcha detected — attempting 2captcha solve")
        solved = await detect_and_solve_captcha(page)
        if not solved:
            print("[ats-form] Could not solve hCaptcha")
            return {
                "success": False,
                "error": "captcha_unsolvable",
                "captcha": True,
                "captcha_type": "hcaptcha",
                "message": "Could not solve hCaptcha automatically",
            }
        print("[ats-form] hCaptcha solved — proceeding to submit")

    async def _check_success() -> dict | None:
        page_text = await page.inner_text("body")
        print(f"[ats-form] Lever: page text after submit:\n{page_text[:2000]}")
        if any(s in page_text.lower() for s in [
            "thank you", "application received", "successfully", "we'll be in touch"
        ]):
            return {"success": True, "filled": filled, "ats": "lever"}
        return None

    async def _check_lever_error() -> str | None:
        page_text = await page.inner_text("body")
        text_lower = page_text.lower()
        if "error verifying your application" in text_lower or "please try again" in text_lower:
            return page_text.strip()[:500]
        return None

    async def _retry_lever_submit() -> bool:
        # Re-query fresh each attempt rather than reusing a stale ElementHandle
        # — the original "Element is not visible" failure came from clicking a
        # handle to a button that Lever had already replaced/repositioned
        # after rendering the error banner.
        print("[ats-form] Lever: error detected — waiting 2s and retrying submit")
        await page.wait_for_timeout(2000)

        for sel in ('button[type="submit"]', 'button:has-text("SUBMIT APPLICATION")'):
            try:
                btn = await page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    print(f"[ats-form] Lever: retried submit via {sel!r}")
                    await page.wait_for_timeout(4000)
                    return True
            except Exception as e:
                print(f"[ats-form] Lever: retry via {sel!r} failed: {e}")

        try:
            btn = page.get_by_text("SUBMIT APPLICATION")
            if await btn.count() > 0:
                await btn.first.click()
                print("[ats-form] Lever: retried submit via get_by_text")
                await page.wait_for_timeout(4000)
                return True
        except Exception as e:
            print(f"[ats-form] Lever: retry via get_by_text failed: {e}")

        return False

    async def _handle_lever_error() -> dict | None:
        """Returns a failure dict if a Lever error persists after retrying,
        a success dict if the retry actually confirmed submission, or None if
        no error was present (caller should continue with its own fallback)."""
        lever_error = await _check_lever_error()
        if not lever_error:
            return None

        print(f"[ats-form] Lever: verification error detected: {lever_error[:200]}")
        if await _retry_lever_submit():
            ok = await _check_success()
            if ok:
                return ok
            lever_error = await _check_lever_error()
            if not lever_error:
                # Retry click went through with no confirmation text and no
                # error either — treat like the existing "no explicit
                # confirmation" case rather than guessing further here.
                return None

        return {"success": False, "error": lever_error, "filled": filled, "ats": "lever"}

    # Try JS form.submit() first — bypasses LinkedIn iframe overlay
    try:
        submitted = await page.evaluate("""() => {
            const form = document.querySelector('form')
            if (form) { form.submit(); return true }
            return false
        }""")
        if submitted:
            await page.wait_for_timeout(3000)
            ok = await _check_success()
            if ok:
                return ok
            error_result = await _handle_lever_error()
            if error_result:
                return error_result
    except Exception as e:
        print(f"[ats-form] Lever: JS submit error: {e}")

    # Fall back to hiding LinkedIn iframe + force click
    try:
        submit = await page.query_selector('button[type="submit"]')
        if submit:
            await page.evaluate("""() => {
                document.querySelectorAll('.IN-widget iframe')
                    .forEach(f => f.style.display = 'none')
            }""")
            await submit.click(force=True)
            await page.wait_for_timeout(4000)
            ok = await _check_success()
            if ok:
                return ok
            error_result = await _handle_lever_error()
            if error_result:
                return error_result
            # Neither a confirmation nor an error: not proof it went through.
            # This used to report success ("Submitted (no explicit
            # confirmation)"), marking the job applied.
            return {
                "success": False,
                "error": "unconfirmed",
                "filled": filled,
                "ats": "lever",
                "message": "Lever showed no confirmation after submit — check the employer's site.",
            }
    except Exception as e:
        print(f"[ats-form] Lever: submit click error: {e}")

    return {"success": False, "error": "Lever submit failed", "filled": filled}


_LEVER_QUESTIONS_JS = """() => [...document.querySelectorAll('.application-question')].map((q, i) => {
    const labelEl = q.querySelector('.application-label, .text');
    const inputs = [...q.querySelectorAll('input, select, textarea')].filter(el => el.type !== 'hidden');
    const named = inputs.find(el => el.name) || inputs[0];
    if (!named) return null;
    const kind = named.tagName === 'SELECT' ? 'select'
        : named.tagName === 'TEXTAREA' ? 'textarea'
        : (named.type === 'radio' || named.type === 'checkbox') ? named.type : 'text';
    const options = named.tagName === 'SELECT'
        ? [...named.options].map(o => ({value: o.value, text: o.text.trim()}))
        : inputs.filter(el => el.type === kind).map(el => ({
            value: el.value, text: ((el.closest('label') || {}).innerText || el.value || '').trim()}));
    return {
        index: i,
        name: named.name || '',
        kind,
        label: labelEl ? labelEl.innerText.replace(/\\s+/g, ' ').trim() : '',
        required: !!q.querySelector('.required') || inputs.some(el => el.required),
        filled: kind === 'radio' || kind === 'checkbox' ? inputs.some(el => el.checked)
            : !!(named.value && named.value.trim()),
        options,
    };
}).filter(Boolean)"""

# Lever's standard fields, filled above from the user's details.
_LEVER_STANDARD = ("name", "email", "phone", "org", "location", "resume", "comments", "urls[")


async def _fill_lever_questions(page, applicant: ApplicantData, cv_text: str, filled: list[str]) -> list[str]:
    """Answer Lever's custom questions (cards[…]) and surveys from the user's
    own data. Returns the required questions left unanswered."""
    missing: list[str] = []
    for q in await page.evaluate(_LEVER_QUESTIONS_JS):
        name, kind, label = q["name"], q["kind"], q["label"].replace("✱", "").strip()
        if not name or name.startswith(_LEVER_STANDARD) or q["filled"]:
            continue
        options = [o for o in q["options"] if o["text"] and o["value"] != ""]
        texts = [o["text"] for o in options]

        answer = None
        if name.startswith("surveysResponses["):
            # Voluntary EEO survey: only "decline", and only if it's required.
            if q["required"]:
                answer = next((t for t in texts if is_decline_option(t)), None)
        else:
            answer = _answer_question(label, applicant)
            if answer is None and kind == "textarea" and claude_may_answer(label, is_long_text=True):
                answer = await _ask_claude_for_answer(label, cv_text)

        done = False
        try:
            if answer is not None and kind in ("select", "radio", "checkbox"):
                idx = match_option(texts, answer)
                if idx != -1:
                    value = options[idx]["value"]
                    if kind == "select":
                        await page.locator(f'select[name="{name}"]').select_option(value=value)
                    else:
                        await page.locator(f'input[name="{name}"][value="{value}"]').check()
                    done = True
            elif answer is not None:
                tag = "textarea" if kind == "textarea" else "input"
                await page.locator(f'{tag}[name="{name}"]').fill(answer)
                done = True
        except Exception as e:
            print(f"[ats-form] Lever: could not answer {label!r}: {e}")

        if done:
            filled.append(f"lever_{name}")
            print(f"[ats-form] Lever: answered {label!r}")
        elif q["required"]:
            missing.append(label or name)
    return missing


async def _fill_greenhouse_form(
    page,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    cv_path: str,
    cover_letter: str,
    linkedin_url: str,
    applicant: ApplicantData,
    cv_text: str,
) -> dict:
    """Fill a Greenhouse-shaped application form: name/email, phone+country,
    location, resume, cover letter, custom questions, and EEO fields.

    Selectors here (#first_name, #candidate-location, question_* ids, the
    numeric EEO ids) are Greenhouse's specifically — this is also the fill
    function invoked for workable/bamboohr/comeet/teamtailor since none of
    those get their own dedicated handling, but the DOM it targets is
    Greenhouse's. (Ashby has its own: ashby_form.py.) Submit + confirmation
    detection happens in the caller.

    Returns {"filled": [...], "errors": [...]} on the normal path, or
    {"early_result": {...full result dict...}} if an unsolvable CAPTCHA, or a
    required question the user hasn't answered, means it must not submit.
    """

    filled: list[str] = []
    errors: list[str] = []
    # A required phone country we couldn't set (see the phone section).
    phone_missing: list[str] = []

    # Step 1: let the form finish rendering before touching any field —
    # Greenhouse's embedded form does its own client-side init after load.
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)

    # Debug: check whether react-select has actually mounted on #country
    # before we touch it. aria-expanded/aria-controls only appear once the
    # library has attached its accessibility wiring to the input; if those
    # are missing (and there's no __reactFiber*/__reactInternalInstance* key
    # on the input or its select-ish ancestor either), every dropdown-open
    # attempt downstream is racing a component that isn't mounted yet, not
    # failing because of a wrong selector or event type.
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(3000)

    init_check = await page.evaluate(
        """() => {
            const input = document.querySelector('#country');
            if (!input) return 'no input';

            const keys = Object.keys(input);
            const reactKeys = keys.filter(k =>
                k.includes('react') || k.includes('React')
            );

            const container = input.closest('[class*="select"]');
            const containerKeys = container
                ? Object.keys(container).filter(k =>
                    k.includes('react') || k.includes('React')
                )
                : [];

            return {
                inputReactKeys: reactKeys,
                containerReactKeys: containerKeys,
                inputType: input.type,
                inputRole: input.getAttribute('role'),
                ariaExpanded: input.getAttribute('aria-expanded'),
                ariaControls: input.getAttribute('aria-controls'),
            };
        }"""
    )
    print(f"[ats-form] Country React init check: {init_check}")

    try:
        os.makedirs("/app/screenshots", exist_ok=True)
        await page.screenshot(path="/app/screenshots/form_initial.png")
    except Exception as e:
        print(f"[ats-form] Could not save initial-state screenshot: {e}")

    async def fill_field(selectors: list[str], value: str, field_name: str, react_sync: bool = False) -> bool:
        for selector in selectors:
            try:
                el = await page.wait_for_selector(selector, timeout=3000, state="visible")
                if el:
                    if react_sync:
                        # Real keyboard typing instead of .fill()/value-tracker — see
                        # _type_into_element for why. Confirmed working for
                        # first/last/email; don't swap back to .fill()-based
                        # clearing, that's the exact bug this fixed.
                        await _type_into_element(page, el, value)
                        seen_value = await page.evaluate(
                            "(sel) => document.querySelector(sel)?.value", selector
                        )
                        print(f"[ats-form] After keyboard type {selector!r}: {seen_value!r}")
                    else:
                        await el.fill(value)
                    filled.append(field_name)
                    print(f"[ats-form] Filled {field_name}")
                    return True
            except Exception:
                continue
        errors.append(f"Could not find {field_name}")
        print(f"[ats-form] WARNING: Could not find {field_name}")
        return False

    async def upload_file(selectors: list[str], path: str, field_name: str) -> bool:
        for selector in selectors:
            try:
                el = await page.wait_for_selector(selector, timeout=3000)
                if el:
                    await el.set_input_files(path)
                    filled.append(field_name)
                    print(f"[ats-form] Uploaded {field_name}")
                    return True
            except Exception:
                continue
        errors.append(f"Could not upload {field_name}")
        print(f"[ats-form] WARNING: Could not upload {field_name}")
        return False

    # Steps 2-4: first name, last name, email
    await _human_delay(page, 300, 600)
    await fill_field([
        "#first_name",
        'input[id="first_name"]',
        'input[name="first_name"]',
        'input[placeholder*="First"]',
        'input[id="first-name"]',
        'input[id*="first_name"]',
    ], first_name, "first_name", react_sync=True)

    await _human_delay(page)
    await fill_field([
        "#last_name",
        'input[id="last_name"]',
        'input[name="last_name"]',
        'input[placeholder*="Last"]',
        'input[id="last-name"]',
        'input[id*="last_name"]',
    ], last_name, "last_name", react_sync=True)

    await _human_delay(page)
    await fill_field([
        "#email",
        'input[id="email"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[id*="email"]',
    ], email, "email", react_sync=True)

    # Phone country: from the user's own number (see "Phone country pickers"
    # above). Without a number the pickers are left alone.
    phone_info = parse_phone(phone) if phone else None
    phone_pickers: dict[str, str] = {}
    if phone:
        if phone_info is None:
            print(f"[ats-form] Phone country: can't place {phone!r} (no country code) — pickers left alone")
        phone_pickers["react-select"] = await _set_react_select_phone_country(page, phone_info)

    # Candidate location — separate free-text field some Greenhouse boards show
    # alongside (not instead of) the country autocomplete above. The user's
    # city only; it used to add ", Israel" whatever the user had saved.
    location_text = applicant.city or ""
    candidate_location_found = False
    try:
        location_field = page.locator('#candidate-location')
        if location_text and await location_field.count() > 0:
            candidate_location_found = True
            await _react_fill(page, "#candidate-location", location_text)
            filled.append("candidate_location")
            print(f"[ats-form] Filled candidate-location: {location_text}")

            # Verify the value actually stuck — some Greenhouse boards wrap
            # this in a JS-controlled autocomplete that silently reverts fill().
            val = await page.locator("#candidate-location").input_value()
            print(f"[ats-form] candidate-location value: {val!r}")
    except Exception as e:
        print(f"[ats-form] candidate-location field error: {e}")

    # Some boards use a differently-named city/location field instead of
    # #candidate-location — only try these if that one wasn't found, so we
    # don't double-fill the same location under two different selectors.
    if location_text and not candidate_location_found:
        for selector in [
            "#location",
            'input[placeholder*="city" i]',
            'input[placeholder*="location" i]',
            'input[name*="location" i]',
        ]:
            try:
                loc = page.locator(selector)
                if await loc.count() > 0:
                    el = await loc.first.element_handle()
                    await _type_into_element(page, el, location_text)
                    filled.append("location")
                    print(f"[ats-form] Filled location via {selector!r}: {location_text}")
                    break
            except Exception as e:
                print(f"[ats-form] location field {selector!r} error: {e}")

    # Greenhouse old form: country-code select dropdown
    if phone:
        phone_pickers["select"] = await _set_select_phone_country(page, phone_info)

    # Phone: ITI library wraps the tel input with a country-flag picker.
    # Only interact if we actually have a phone number — touching ITI with no
    # number can leave the field in a broken state.
    if not phone:
        print("[ats-form] No phone value — leaving phone field untouched")
    else:
        # New boards wrap the react-select chip in an .iti element too; the
        # intl-tel-input dropdown is only a picker of its own where there's no
        # react-select (seen on 20 live boards, 2026-10-05: all react-select).
        if phone_pickers["react-select"] == "absent":
            phone_pickers["intl-tel-input"] = await _set_iti_phone_country(page, phone_info)
        print(f"[ats-form] Phone country pickers: {phone_pickers}")
        # With the country chosen in a picker, the field takes the national
        # number; otherwise the full international one, which names its
        # country itself. A number we can't place is typed as saved.
        if "set" in phone_pickers.values():
            filled.append("phone_country")
            clean_phone = phone_info.national_digits
        elif phone_info:
            clean_phone = phone_info.e164
        else:
            clean_phone = phone
        if phone_pickers["react-select"] == "failed" and await _phone_country_required(page):
            phone_missing.append("Phone country")

        try:
            phone_el = await page.query_selector(
                'input[id="phone"], input[type="tel"], input[id*="phone"]'
            )
            if phone_el:
                await phone_el.click()
                await page.wait_for_timeout(200)
                await phone_el.fill("")
                await page.keyboard.type(clean_phone, delay=50)
                await page.wait_for_timeout(200)
                val = await page.input_value(
                    'input[id="phone"], input[type="tel"], input[id*="phone"]'
                )
                filled.append("phone")
                print(f"[ats-form] Typed phone: {clean_phone!r} → field value: '{val}'")

                # ITI (intl-tel-input) wraps the real input in its own JS
                # widget — re-dispatch events so React's controlled state
                # (and ITI's own internal formatting) actually picks up the
                # typed value rather than reverting on blur.
                await page.evaluate("""
                    const phoneInput = document.querySelector('#phone');
                    if (phoneInput) {
                        phoneInput.dispatchEvent(new Event('input', {bubbles: true}));
                        phoneInput.dispatchEvent(new Event('change', {bubbles: true}));
                        phoneInput.dispatchEvent(new Event('blur', {bubbles: true}));
                    }
                """)
        except Exception as e:
            print(f"[ats-form] Phone type error: {e}")

    resume_upload_selectors = [
        "#resume",
        'input[id="resume"]',
        'input[type="file"][name="resume"]',
        'input[type="file"][id*="resume"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"]',
    ]

    # Diagnostic: enumerate every file input on the page. There have been
    # repeated "resume not attaching" reports despite #resume existing and
    # set_input_files() succeeding — this tells us on the next real run
    # whether #resume is actually the input Greenhouse reads from, or
    # whether there's a second/decoy file input we're missing entirely.
    file_inputs = await page.locator('input[type="file"]').all()
    print(f"[ats-form] Found {len(file_inputs)} file input(s) on page")
    for i, inp in enumerate(file_inputs):
        inp_id = await inp.get_attribute("id")
        inp_name = await inp.get_attribute("name")
        print(f"[ats-form] File input {i}: id={inp_id!r} name={inp_name!r}")

    # set_input_files() sets files via CDP, not via JS assignment — it does
    # NOT require the input to be visible (unlike .fill()/.click(), it skips
    # the standard visibility actionability check entirely), so a hidden
    # input behind a styled "Attach" button is not on its own a reason this
    # would fail. Try the direct locators first; only fall back to clicking
    # a visible trigger button if none of them exist in the DOM at all.
    resume_direct_locators = [
        page.locator('input[type="file"]#resume'),
        page.locator('input[type="file"][name="resume"]'),
        page.locator('input[type="file"]').first,
    ]
    resume_set = False
    for locator in resume_direct_locators:
        if await locator.count() > 0:
            try:
                await locator.set_input_files(cv_path, no_wait_after=True)
                await page.wait_for_timeout(1000)
                files_count = await locator.evaluate("el => el.files ? el.files.length : 0")
                print(f"[ats-form] set_input_files via {locator!r} -> files.length={files_count}")
                if files_count > 0:
                    filled.append("resume")
                    resume_set = True
                    print("[ats-form] Resume attached successfully")
                    # set_input_files() goes through CDP, which does fire a
                    # real trusted change/input event in normal cases — but
                    # some React uploaders attach their handler after their
                    # own async init, missing that first event. A follow-up
                    # dispatch is cheap insurance so React's own UI (e.g. a
                    # "resume.pdf attached" label) picks up the file too, not
                    # just el.files itself.
                    try:
                        await locator.evaluate(
                            """(el) => {
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                            }"""
                        )
                        print("[ats-form] Re-dispatched change/input for resume input")
                    except Exception as e:
                        print(f"[ats-form] Resume change/input re-dispatch failed (non-fatal): {e}")
                    break
            except Exception as e:
                print(f"[ats-form] set_input_files via {locator!r} failed: {e}")

    if not resume_set:
        # No file input matched anything, or files.length stayed 0 for all
        # of them — try clicking the visible trigger first (Greenhouse hides
        # the real input behind it on some boards) before the usual
        # multi-selector upload.
        try:
            upload_btn = await page.query_selector(
                'button:has-text("Attach"), label[for*="resume"], button:has-text("Upload")'
            )
            if upload_btn:
                await upload_btn.click()
                await page.wait_for_timeout(500)
                print("[ats-form] Clicked resume upload trigger")
        except Exception:
            pass

        await upload_file(resume_upload_selectors, cv_path, "resume")

    # Verify the browser actually registered a file — set_input_files()
    # returning True only means Playwright found a matching element and
    # called the API, not that Greenhouse's own JS accepted it as the real
    # upload target (e.g. a decoy/duplicate input in the DOM).
    async def _resume_confirmed() -> bool:
        resume_field = page.locator("#resume")
        resume_value = await resume_field.input_value() if await resume_field.count() > 0 else ""
        print(f"[ats-form] Resume field value: {resume_value!r}")

        files_count = 0
        try:
            if await resume_field.count() > 0:
                files_count = await resume_field.evaluate("el => el.files.length")
        except Exception:
            pass
        print(f"[ats-form] Resume files count: {files_count}")

        file_display = await page.locator(
            '[class*="filename"], [class*="file-name"], '
            '.file-chosen, .upload-filename'
        ).all_inner_texts()
        print(f"[ats-form] File display: {file_display}")

        attached_indicators = await page.locator(
            '[class*="filename"], [class*="file-name"], '
            '.resume-filename, p:has-text(".pdf")'
        ).count()
        print(f"[ats-form] Resume attached indicators: {attached_indicators}")

        return bool(resume_value) or files_count > 0 or any(file_display) or attached_indicators > 0

    try:
        if not await _resume_confirmed():
            print("[ats-form] Resume upload not confirmed — retrying")

            # Retry 1: click the upload trigger again, in case the first
            # click didn't actually reveal/activate the real file input.
            retry_btn = await page.query_selector(
                'button:has-text("Attach"), label[for*="resume"], button:has-text("Upload")'
            )
            if retry_btn:
                await retry_btn.click()
                await page.wait_for_timeout(500)
                print("[ats-form] Retried resume upload trigger click")

            # Retry 2: re-attempt set_input_files. Note there is no such
            # thing as "setting a file input via JS" — browsers block
            # programmatic assignment to input.files for security, so
            # set_input_files() (which goes through CDP, not page JS) is
            # the only real mechanism; retrying it is the direct-input path.
            await upload_file(resume_upload_selectors, cv_path, "resume")

            if not await _resume_confirmed():
                # Retry 3: some upload buttons open the browser's native file
                # picker rather than exposing a directly targetable <input
                # type=file> — expect_file_chooser intercepts that dialog so
                # we can supply the file without ever touching the OS UI.
                print("[ats-form] Still not confirmed — trying file chooser fallback")
                try:
                    async with page.expect_file_chooser(timeout=5000) as fc_info:
                        trigger = page.locator(
                            'button:has-text("Attach"), [class*="upload"], #resume-upload-trigger'
                        )
                        if await trigger.count() > 0:
                            await trigger.first.click()
                    file_chooser = await fc_info.value
                    await file_chooser.set_files(cv_path)
                    filled.append("resume")
                    print("[ats-form] Uploaded resume via file chooser")
                except Exception as e:
                    print(f"[ats-form] File chooser fallback failed: {e}")

                if not await _resume_confirmed():
                    print("[ats-form] WARNING: Resume still not confirmed attached after all retries")
    except Exception as e:
        print(f"[ats-form] Resume verification error: {e}")

    cover_letter_filled = await fill_field([
        'textarea[name="cover_letter"]',
        'textarea[id*="cover_letter"]',
        'textarea[placeholder*="cover"]',
    ], cover_letter, "cover_letter_text")

    if not cover_letter_filled:
        with tempfile.NamedTemporaryFile(
            suffix=".txt", delete=False, prefix="cl_", mode="w", encoding="utf-8"
        ) as tmp:
            tmp.write(cover_letter)
            cl_path = tmp.name
        try:
            await upload_file([
                'input[type="file"][name="cover_letter"]',
                'input[type="file"][id*="cover"]',
            ], cl_path, "cover_letter_file")
        finally:
            try:
                os.unlink(cl_path)
            except Exception:
                pass

    if linkedin_url:
        await fill_field([
            'input[name="linkedin_profile_url"]',
            'input[id*="linkedin"]',
            'input[placeholder*="LinkedIn"]',
            'input[placeholder*="linkedin"]',
        ], linkedin_url, "linkedin")

    # ── Custom questions (Greenhouse question_XXXXXXX fields) ────────────────

    # Diagnostic: dump every input/select/textarea on the page before
    # matching on `[id^="question_"]`. If custom questions are showing
    # empty, this is how we tell whether the selector genuinely isn't
    # matching this board's field ids (some non-Greenhouse boards behind
    # this same function — workable/bamboohr/comeet/teamtailor/ashby — use
    # a completely different id scheme) versus the fields matching fine but
    # the answer not sticking.
    all_inputs = await page.evaluate(
        """() => {
            const result = [];
            document.querySelectorAll('input, select, textarea').forEach(el => {
                result.push({
                    id: el.id,
                    name: el.name,
                    type: el.type || el.tagName,
                    value: el.value,
                    placeholder: el.placeholder,
                });
            });
            return result;
        }"""
    )
    print(f"[ats-form] ALL inputs before custom-question fill: {all_inputs}")

    custom_questions = await page.query_selector_all(
        'input[id^="question_"], textarea[id^="question_"], select[id^="question_"]'
    )
    print(f"[ats-form] Matched {len(custom_questions)} custom question field(s) via [id^='question_']")
    # Required questions the user gave us no answer for — the form is not
    # submitted if any (see application_answers). Until 2026-10-04 these got
    # made-up defaults, a Claude-picked or the first option, or a Claude answer.
    missing: list[str] = list(phone_missing)
    for q in custom_questions:
        q_id = await q.get_attribute("id") or ""
        tag_name = await q.evaluate("el => el.tagName.toLowerCase()")
        q_type = await q.get_attribute("type") or "text"
        if q_type in ("file", "checkbox", "radio", "hidden"):
            continue

        label = await page.query_selector(f'label[for="{q_id}"]')
        label_text = (await label.inner_text()).strip() if label else ""
        required = (
            label_text.endswith("*")
            or await q.get_attribute("required") is not None
            or await q.get_attribute("aria-required") == "true"
        )
        label_text = label_text.rstrip(" *")
        print(f"[ats-form] Custom question: {q_id} ({tag_name}) — {label_text} (required={required})")

        answer = _answer_question(label_text, applicant) if label_text else None
        if answer is None and tag_name == "textarea" and claude_may_answer(label_text, is_long_text=True):
            answer = await _ask_claude_for_answer(label_text, cv_text)

        done = False
        try:
            if tag_name == "select" and answer is not None:
                options = await q.evaluate(
                    "el => Array.from(el.options).map(o => ({value: o.value, text: o.text.trim()}))"
                )
                real = [o for o in options if o["value"] != ""]
                idx = match_option([o["text"] for o in real], answer)
                if idx != -1:
                    await q.select_option(value=real[idx]["value"])
                    # select_option() already dispatches native events, but
                    # dispatch an explicit change too — cheap insurance given
                    # how many "reported success, React never saw it" cases
                    # showed up for other field types in this exact file.
                    await q.evaluate(
                        """(el, val) => {
                            el.value = val;
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }""",
                        real[idx]["value"],
                    )
                    done = True
                else:
                    print(f"[ats-form] {label_text!r}: the user's answer {answer!r} isn't one of the options")
            elif answer is not None:
                await q.click()
                await _apply_react_value(page, q, answer)
                done = True
        except Exception as e:
            print(f"[ats-form] Could not fill custom question {q_id}: {e}")

        if done:
            filled.append(f"custom_{q_id}")
            print(f"[ats-form] Answered custom question {q_id} ({label_text!r})")
        elif required:
            missing.append(label_text or q_id)

    if missing:
        print(f"[ats-form] Not submitting — no answer from the user for: {missing}")
        return {"early_result": _missing_answers_result(missing, filled)}

    # ── Verify no required fields were left empty ─────────────────────────────
    # A final sweep across the whole form (not just the custom questions
    # above) — catches anything required that none of the earlier steps
    # matched, so we at least know about it before submit fails.
    try:
        required_empty = await page.evaluate("""
            () => {
                const empties = [];
                document.querySelectorAll(
                    'input[required], select[required], textarea[required]'
                ).forEach(el => {
                    if (!el.value) {
                        empties.push({ id: el.id, type: el.type, tagName: el.tagName });
                    }
                });
                return empties;
            }
        """)
        print(f"[ats-form] Required empty fields: {required_empty}")
    except Exception as e:
        print(f"[ats-form] Could not check required fields: {e}")

    # ── Full required-field audit + screenshot, right before submit ──────────
    # Saved to /app/screenshots/ — the volume docker-compose actually mounts
    # (./ai-service/screenshots:/app/screenshots). Every other diagnostic
    # screenshot in this file goes to /tmp, which isn't persisted or
    # reachable after the container exits, so none of them are actually
    # inspectable after the fact.
    try:
        all_required_fields = await page.evaluate("""
            () => {
                const fields = [];
                document.querySelectorAll(
                    'input[required], select[required], textarea[required]'
                ).forEach(el => {
                    fields.push({ id: el.id, type: el.type || el.tagName, value: el.value });
                });
                return fields;
            }
        """)
        print(f"[ats-form] All required fields before submit: {all_required_fields}")
    except Exception as e:
        print(f"[ats-form] Could not list required fields: {e}")

    try:
        os.makedirs("/app/screenshots", exist_ok=True)
        pre_submit_screenshot = f"/app/screenshots/pre_submit_{int(time.time())}.png"
        await page.screenshot(path=pre_submit_screenshot, full_page=True)
        print(f"[ats-form] Pre-submit screenshot saved: {pre_submit_screenshot}")
    except Exception as e:
        print(f"[ats-form] Could not save pre-submit screenshot: {e}")

    # ── CAPTCHA check — attempt to solve with 2captcha, bail only if unsolvable ──
    # Only targets visible user challenges. reCAPTCHA v3 (invisible) runs silently
    # in the background — matching `iframe[src*="recaptcha"]` is a false positive.

    captcha_el = await page.query_selector(
        '.g-recaptcha[data-sitekey]:not([data-size="invisible"]), '
        'input[name="h-captcha-response"], .h-captcha, iframe[src*="hcaptcha"]'
    )
    if captcha_el:
        name_attr = await captcha_el.get_attribute("name") or ""
        src_attr = await captcha_el.get_attribute("src") or ""
        class_attr = await captcha_el.get_attribute("class") or ""
        captcha_type = "hcaptcha" if "hcaptcha" in (name_attr + src_attr + class_attr) else "recaptcha"
        print(f"[ats-form] CAPTCHA detected: {captcha_type} — attempting 2captcha solve")
        solved = await detect_and_solve_captcha(page)
        if not solved:
            print("[ats-form] CAPTCHA could not be solved automatically")
            return {
                "early_result": {
                    "success": False,
                    "error": "captcha_detected",
                    "captcha": True,
                    "captcha_type": captcha_type,
                    "filled": filled,
                    "message": f"Form has {captcha_type} — could not solve automatically",
                }
            }
        print("[ats-form] CAPTCHA solved, continuing to submit")

    # ── GDPR / consent checkbox ───────────────────────────────────────────────

    # Only consent to processing the application's data (application_answers.
    # is_data_processing_consent) — not marketing ("contact me about future
    # jobs"), background checks or other terms, which any "*consent*" checkbox
    # used to get.
    try:
        for box in await page.query_selector_all(
            'input[type="checkbox"][name*="gdpr"], input[type="checkbox"][name*="consent"], '
            'input[type="checkbox"][id*="gdpr"], input[type="checkbox"][id*="consent"]'
        ):
            label_text = await box.evaluate(
                "el => ((el.labels && el.labels[0]) || el.closest('label') || el.parentElement || {}).innerText || ''"
            )
            if is_data_processing_consent(label_text) and "marketing" not in label_text.lower():
                await box.check()
                filled.append("gdpr_consent")
                print("[ats-form] Checked data-processing consent")
    except Exception:
        pass

    # "How did you hear about us?" is a custom question like any other (above):
    # answered only from the user's saved answer. This used to pick "Other" /
    # "LinkedIn", or else the first option, for any select named hear/source.

    # ── EEO demographic fields (gender, race, veteran, disability) ───────────
    # Different Greenhouse boards use different id schemes for these fields —
    # some semantic ("gender", "veteran_status"), some short numeric custom-
    # question ids ("430", "431"...). Handled in one JS pass rather than
    # per-id Playwright locators/select_option calls, since select_option
    # showed empty React state on submit for some boards even after
    # reporting success. React attaches the same _valueTracker to <select>
    # elements as to text inputs (see _apply_react_value) — a plain
    # `.value = x` + dispatch, with no tracker.setValue() reset, is exactly
    # the bug that was just fixed for first/last/email, just not carried
    # over here yet. The `.options`/length guard protects against a matched
    # element that isn't actually a native <select> (e.g. a custom-rendered
    # dropdown reusing the same id), since such an element wouldn't have a
    # usable `.value`/options list to set anyway.
    # These are voluntary EEO self-identification questions — "Decline to
    # self-identify" is the honest answer when the user hasn't told us. When
    # a field has no decline option it is left alone: it used to get its first
    # real option, i.e. a demographic answer the user never gave.
    EEO_FIELD_IDS = [
        "gender", "hispanic_ethnicity", "veteran_status", "disability_status",
        "430", "431", "432", "433", "434", "436",
    ]
    eeo_set: list[str] = []
    try:
        eeo_set = await page.evaluate(
            """(eeoIds) => {
                const setIds = [];
                eeoIds.forEach(id => {
                    const el = document.querySelector(`select[id="${id}"]`);
                    if (!el || !el.options || el.options.length < 2) return;
                    const opts = Array.from(el.options);
                    const decline = opts.find(o =>
                        o.text.toLowerCase().includes('decline') ||
                        o.text.toLowerCase().includes('prefer not') ||
                        o.text.toLowerCase().includes("don't wish") ||
                        o.text.toLowerCase().includes('do not wish') ||
                        o.text.toLowerCase().includes('i do not')
                    );
                    const target = decline;
                    if (!target) return;
                    const lastValue = el.value;
                    el.value = target.value;
                    const tracker = el._valueTracker;
                    if (tracker) tracker.setValue(lastValue);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    setIds.push(id);
                });
                return setIds;
            }""",
            EEO_FIELD_IDS,
        )
        for field_id in eeo_set:
            filled.append(f"eeo_{field_id}")
        print(f"[ats-form] EEO fields set via JS: {eeo_set}")

        eeo_values = await page.evaluate(
            """(eeoIds) => {
                const result = {};
                eeoIds.forEach(id => {
                    const el = document.querySelector(`select[id="${id}"]`);
                    result[id] = el ? el.value : 'NOT FOUND';
                });
                return result;
            }""",
            EEO_FIELD_IDS,
        )
        print(f"[ats-form] EEO values after JS set: {eeo_values}")
    except Exception as e:
        print(f"[ats-form] EEO fields JS error: {e}")

    # ── EEO fields that are custom React dropdowns, not native <select> ──────
    # The all-inputs diagnostic showed ids 430-436 as type="text" on some
    # boards — real react-select-style widgets, where the JS pass above
    # (which only touches actual <select> elements) never finds anything to
    # set. Only run this for ids the native-select pass above didn't already
    # handle — no point re-doing ids that already worked.
    for field_id in [fid for fid in EEO_FIELD_IDS if fid not in eeo_set]:
        try:
            dropdown = page.locator(f'[id="{field_id}"]')
            if await dropdown.count() == 0:
                continue

            await dropdown.click()
            await page.wait_for_timeout(500)  # Wait for menu

            opts = await page.locator('[role="option"], [class*="select__option"]').all()
            print(f"[ats-form] EEO options after click: {len(opts)}")

            option_locator = page.locator(
                'div[role="option"], li[role="option"], [class*="option"]'
            )
            option_count = await option_locator.count()
            if option_count == 0:
                print(f"[ats-form] EEO {field_id}: clicked but no dropdown options appeared")
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(300)
                continue

            decline_option = page.locator(
                'div[role="option"]:has-text("Decline"), '
                'li:has-text("Decline"), '
                '[class*="option"]:has-text("Decline"), '
                '[class*="option"]:has-text("prefer not")'
            ).first

            if await decline_option.count() > 0:
                await decline_option.click()
                filled.append(f"eeo_{field_id}")
                print(f"[ats-form] EEO {field_id}: clicked decline (React dropdown)")
            else:
                # No decline option: leave it unanswered rather than pick a
                # demographic answer the user never gave (this used to click
                # the first real option).
                print(f"[ats-form] EEO {field_id}: no decline option — left unanswered")

            # Close the menu before moving to the next field — these option
            # selectors aren't scoped to this field's dropdown (React portals
            # often render the menu at the end of <body>), so a menu left
            # open could get matched again while processing the next id.
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(300)
        except Exception as e:
            print(f"[ats-form] EEO {field_id}: React dropdown click failed: {e}")

    # ── Verify React actually picked up our values ────────────────────────────
    # Reads element.value straight from the DOM by id — if this shows the
    # values we filled, React's controlled state genuinely updated; if it
    # shows blanks despite the fields visibly looking filled in a
    # screenshot, the value-tracker trick above didn't take for that field.
    try:
        react_values = await page.evaluate(
            """(eeoIds) => {
                const inputs = document.querySelectorAll(
                    'input[type="text"], input[type="email"], input[type="tel"]'
                );
                const result = {};
                inputs.forEach(el => {
                    if (el.id) result[el.id] = el.value;
                });
                eeoIds.forEach(id => {
                    const el = document.querySelector(`select[id="${id}"]`);
                    if (el) result[id] = el.value;
                });
                return result;
            }""",
            EEO_FIELD_IDS,
        )
        print(f"[ats-form] React state values: {react_values}")
    except Exception as e:
        print(f"[ats-form] Could not read back field values: {e}")

    # ── Pre-submit field value dump ───────────────────────────────────────────

    print("[ats-form] ── PRE-SUBMIT FIELD VALUES ─────────────────────────────")
    try:
        pre_inputs = await page.query_selector_all(
            'input:not([type="hidden"]), select, textarea'
        )
        for inp in pre_inputs:
            name = await inp.get_attribute("name") or ""
            id_ = await inp.get_attribute("id") or ""
            type_ = await inp.get_attribute("type") or "text"
            required = await inp.get_attribute("required")
            try:
                value = await inp.input_value() if type_ != "file" else "[file]"
            except Exception:
                value = "[unreadable]"
            print(
                f"[ats-form] FIELD: name={name} id={id_} type={type_} "
                f"value={repr(value[:60])} required={required}"
            )
    except Exception as e:
        print(f"[ats-form] Pre-submit dump error: {e}")
    print("[ats-form] ────────────────────────────────────────────────────────")

    return {"filled": filled, "errors": errors}


async def _fill_form_fields(
    page,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    cv_path: str,
    cover_letter: str,
    linkedin_url: str,
    applicant: ApplicantData,
    cv_text: str,
) -> dict:
    """Fill the form via _fill_greenhouse_form, then submit and detect the
    outcome. Split in two so filling and submit-confirmation are each their
    own function instead of one 1000+ line block."""

    fill_outcome = await _fill_greenhouse_form(
        page, first_name, last_name, email, phone, cv_path, cover_letter, linkedin_url, applicant, cv_text,
    )
    if "early_result" in fill_outcome:
        return fill_outcome["early_result"]
    filled = fill_outcome["filled"]
    errors = fill_outcome["errors"]

    # ── Submit ────────────────────────────────────────────────────────────────

    # Prefer type=submit over has-text("Apply") — the listing page also has
    # an "Apply" anchor in the header, which would be the wrong button.
    submit_btn = None
    for sel, label in [
        ('button[type="submit"]', "type=submit"),
        ('input[type="submit"]', "input[type=submit]"),
        ('#submit_app', "#submit_app"),
        ('.submit-app', ".submit-app"),
        ('button:has-text("Submit Application")', "Submit Application"),
        ('button:has-text("Submit")', "Submit"),
    ]:
        try:
            btn = await page.query_selector(sel)
            if btn:
                is_visible = await btn.is_visible()
                btn_text = ""
                try:
                    btn_text = (await btn.inner_text()).strip()[:60]
                except Exception:
                    pass
                print(f"[ats-form] Submit candidate: {label!r} text={btn_text!r} visible={is_visible}")
                if is_visible:
                    submit_btn = btn
                    break
        except Exception:
            continue

    if not submit_btn:
        print("[ats-form] ERROR: No visible submit button found")
        os.makedirs("/app/screenshots", exist_ok=True)
        await page.screenshot(path=f"/app/screenshots/no_submit_{int(time.time())}.png", full_page=True)
        return {"success": False, "error": "No submit button found", "filled": filled, "errors": errors}

    try:
        await submit_btn.scroll_into_view_if_needed()
        # Scroll to bottom so the whole form is "seen" before submitting
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await _human_delay(page, 500, 1000)
        # Solve any captcha that appeared dynamically after field fill
        print("[ats-form] Checking for captcha before submit...")
        await detect_and_solve_captcha(page)
        url_before = page.url
        print(f"[ats-form] URL before submit: {url_before}")
        print("[ats-form] Clicking submit button...")
        await _human_click(page, submit_btn)
        print(f"[ats-form] Clicked. URL immediately: {page.url}")
        await page.wait_for_timeout(15000)
        url_after = page.url
        print(f"[ats-form] URL after 15s: {url_after}")

        os.makedirs("/app/screenshots", exist_ok=True)
        screenshot_path = f"/app/screenshots/post_submit_{int(time.time())}.png"
        await page.screenshot(path=screenshot_path, full_page=True)
        print(f"[ats-form] Post-submit screenshot: {screenshot_path}")

        # Check for field validation errors. Named validation_error_msgs, not
        # `errors` — this function already has an `errors` list (accumulated
        # field-fill failures from _fill_greenhouse_form) that's returned in
        # the final result dict; reusing that name here would silently
        # overwrite it.
        validation_error_msgs = await page.evaluate(
            """() => {
                const msgs = [];
                document.querySelectorAll(
                    '.error, .field-error, [class*="error"], '
                    + '[aria-invalid="true"], .invalid-feedback, .validation-error'
                ).forEach(el => {
                    const txt = (el.innerText || '').trim();
                    if (txt) msgs.push(txt);
                });
                return msgs;
            }"""
        )
        print(f"[ats-form] Validation errors: {validation_error_msgs}")

        # Save the full page HTML after submit for debugging
        html = await page.content()
        print("[ats-form] POST-SUBMIT HTML (first 3000):")
        print(html[:3000])

        # ── Detect a silent form reset ────────────────────────────────────────
        # If the Apply button is still visible, we're still looking at the job
        # listing/collapsed-form state — the submit didn't actually go through
        # (most likely a client-side validation error, or the click landed on
        # the wrong element). Dump diagnostics, then try a couple of
        # alternative submit paths before giving up.
        apply_btn_after = await page.locator(
            'button:has-text("Apply"), input[value="Apply"]'
        ).count()

        if apply_btn_after > 0:
            print("[ats-form] Apply button still visible after submit — form likely failed")
            await page.evaluate("window.scrollTo(0, 0)")
            await page.wait_for_timeout(1000)

            page_text_full = await page.inner_text("body")
            lines = [ln.strip() for ln in page_text_full.split("\n") if ln.strip()]
            print("[ats-form] All page text lines after submit:")
            for line in lines[:50]:
                print(f"[ats-form]   {line}")

            print("[ats-form] Retrying via JS document.querySelector('form').submit()...")
            try:
                submitted = await page.evaluate("""() => {
                    const form = document.querySelector('form');
                    if (form) { form.submit(); return true; }
                    return false;
                }""")
                print(f"[ats-form] JS form.submit() returned: {submitted}")
            except Exception as e:
                print(f"[ats-form] JS form.submit() failed: {e}")
            await page.wait_for_timeout(5000)

            if await page.locator('button:has-text("Apply"), input[value="Apply"]').count() > 0:
                print("[ats-form] Still on listing page — trying get_by_role Submit application click")
                try:
                    submit_role_btn = page.get_by_role("button", name="Submit application")
                    if await submit_role_btn.count() > 0:
                        await submit_role_btn.first.click()
                        print("[ats-form] Clicked Submit application via get_by_role")
                        await page.wait_for_timeout(5000)
                except Exception as e:
                    print(f"[ats-form] get_by_role submit click failed: {e}")

            url_after = page.url
            print(f"[ats-form] URL after retry attempts: {url_after}")

        page_text = await page.inner_text("body")
        print(f"[ats-form] FULL page text length: {len(page_text)}")
        print("[ats-form] Page text (first 1000):")
        print(page_text[:1000])
        page_text_lower = page_text.lower()

        # A bare "?" appended to the same path (some Greenhouse boards redirect
        # back to the listing this way when a submit actually fails silently)
        # is NOT evidence of success — only a genuine path change or a new,
        # non-empty query parameter counts.
        before_parts = urlsplit(url_before)
        after_parts = urlsplit(url_after)
        path_changed = after_parts.path.rstrip("/") != before_parts.path.rstrip("/")
        before_query_keys = set(parse_qs(before_parts.query).keys())
        after_query = parse_qs(after_parts.query)
        has_new_meaningful_query_param = any(
            key not in before_query_keys and any(v.strip() for v in values)
            for key, values in after_query.items()
        )
        url_indicates_success = path_changed or has_new_meaningful_query_param

        # ── Greenhouse security-code human-verification gate ──────────────────
        # Greenhouse's own anti-bot (reCAPTCHA-driven) gate. The one-time code
        # it emails is tied to the browser session that triggered it — our
        # server's headless browser, not the user's — so there's no "open
        # this link and enter the code" flow that could ever work here
        # (verified manually). Treated as an ordinary needs_manual outcome
        # rather than a status of its own; see CLAUDE.md's Playwright caveats
        # for why this wasn't built out further. Detection (known page copy
        # plus the #security-input-0..7 boxes Greenhouse injects for the
        # code) is kept so the error message is specific instead of a vague
        # "unknown state".
        security_code_text_signals = [
            "verification code",
            "security code",
            "confirm you're a human",
        ]
        security_code_input_count = await page.locator(
            ", ".join(f"#security-input-{i}" for i in range(8))
        ).count()
        text_signal_matched = any(s in page_text_lower for s in security_code_text_signals)
        if text_signal_matched or security_code_input_count > 0:
            print(
                f"[ats-form] Greenhouse security-code gate detected — can't be completed from here "
                f"(text_match={text_signal_matched}, security_input_count={security_code_input_count})"
            )
            return {
                "success": False,
                "error": "security_code_required",
                "filled": filled,
                "message": "Greenhouse requires a security code sent to the browser session that filled this form — please apply manually.",
            }

        # ── URL contains confirmation path ────────────────────────────────────
        # "?gh_jid=" shows up on Greenhouse's post-apply confirmation redirect
        # for some job boards even when there's no "thank you" wording on the page.
        if any(k in url_after for k in ("confirmation", "thank", "success", "submitted", "?gh_jid=")):
            print(f"[ats-form] SUCCESS — URL indicates confirmation: {url_after}")
            return {"success": True, "filled": filled, "message": "Application submitted (URL confirmation)"}

        # ── URL changed to a genuinely different path, or gained a real query param ──
        if url_indicates_success:
            reason = "path changed" if path_changed else "gained a new query parameter"
            print(f"[ats-form] SUCCESS — URL {reason}: {url_before} → {url_after}")
            return {"success": True, "filled": filled, "message": "Application submitted (URL changed)"}
        elif url_after != url_before:
            print(
                f"[ats-form] URL changed but only by a bare '?' or empty query param — "
                f"not treating as success: {url_before} → {url_after}"
            )

        # ── Explicit text success signals ─────────────────────────────────────
        success_signals = [
            "thank you", "thank you for applying", "application received",
            "successfully submitted", "we'll be in touch",
            "application has been submitted", "your application has been",
            "תודה",
        ]
        if any(s in page_text_lower for s in success_signals):
            print("[ats-form] SUCCESS confirmed via page text")
            return {"success": True, "filled": filled, "message": "Application submitted successfully"}

        # ── Confirmation modal ────────────────────────────────────────────────
        modal = await page.query_selector(
            '.modal, .dialog, [role="dialog"], '
            '[class*="confirmation"], [class*="Confirmation"], '
            '[class*="success"], [class*="Success"], '
            '.application-confirmation, [data-qa="confirmation"]'
        )
        if modal:
            modal_text = (await modal.inner_text()).strip()
            print(f"[ats-form] Modal found: {modal_text[:200]}")
            if any(p in modal_text.lower() for p in ["thank", "submitted", "received", "success"]):
                print("[ats-form] SUCCESS confirmed via modal")
                return {"success": True, "filled": filled, "message": "Application submitted (modal confirmation)"}

        # ── Real field-level errors ───────────────────────────────────────────
        real_errors = await page.evaluate("""() => {
            const selectors = [
                '.error:not(form)', '.field-error',
                '[class*="error--"]', '.greenhouse-field-error',
                '[data-error]', '.invalid-feedback',
                '.sc-error', '[class*="FieldError"]'
            ];
            const seen = new Set();
            const result = [];
            for (const sel of selectors) {
                document.querySelectorAll(sel).forEach(el => {
                    const text = (el.innerText || '').trim();
                    if (text && text !== '*' &&
                        !text.includes('indicates a required field') &&
                        !text.includes('* =') &&
                        text.length > 2 && !seen.has(text)) {
                        seen.add(text);
                        result.push(text);
                    }
                });
            }
            return result;
        }""")

        if real_errors:
            print(f"[ats-form] Real field errors detected: {real_errors}")
            os.makedirs("/app/screenshots", exist_ok=True)
            err_screenshot_path = f"/app/screenshots/form_error_{int(time.time())}.png"
            await page.screenshot(path=err_screenshot_path, full_page=True)
            print(f"[ats-form] Error screenshot: {err_screenshot_path}")
            return {
                "success": False,
                "error": f"Form errors: {'; '.join(real_errors[:3])}",
                "filled": filled,
                "errors": errors,
            }

        # ── Unknown state — no confirmation signals found ─────────────────────
        # A bare "?" URL change with no path change and no meaningful query
        # value lands here rather than being guessed as a success — this
        # `success: False` surfaces as needs_manual via ats_apply.py, same as
        # any other unresolved outcome.
        print("[ats-form] No confirmation signals found — unknown state")
        return {
            "success": False,
            "error": "unknown_state",
            "filled": filled,
            "message": "Could not confirm if application was submitted. Check your email or the job portal.",
        }

    except Exception as e:
        return {"success": False, "error": f"Submit failed: {str(e)}", "filled": filled, "errors": errors}
