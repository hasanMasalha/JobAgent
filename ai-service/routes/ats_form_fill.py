import asyncio
import os
import random
import tempfile
import time
from urllib.parse import parse_qs, urlsplit

import anthropic
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async

from captcha_solver import detect_and_solve_captcha

_claude_client = anthropic.Anthropic()


def _fast_path_answer(label_text: str, profile: dict, linkedin_url: str) -> str | None:
    """Deterministic answers for well-known Greenhouse question patterns, using
    the candidate's structured profile fields. Returns None when nothing
    matches, so the caller falls back to asking Claude instead of guessing."""
    label = label_text.lower()

    # Standard GDPR/data-privacy consent-to-processing boilerplate — every
    # ATS form gates submission on this, and it's not a substantive legal
    # question (unlike background checks, non-competes, etc. below), so
    # answering it is required just to submit the application at all.
    # Deliberately narrow: NOT matching bare "consent"/"agree"/"terms"/
    # "policy" here — those also show up on background-check consent,
    # drug-testing policy, non-compete/arbitration terms, which DO carry
    # real legal consequences and must not be auto-affirmed.
    if any(k in label for k in ("privacy", "gdpr", "data protection")):
        return "I agree"
    if "linkedin" in label:
        return linkedin_url or "N/A"
    if any(k in label for k in ("github", "portfolio", "personal website", "website")):
        return profile.get("github_url") or profile.get("portfolio_url") or "N/A"
    if any(k in label for k in ("how did you hear", "hear about", "how did you find")):
        return "LinkedIn"
    if any(k in label for k in ("sponsorship", "visa sponsorship")):
        return "Yes" if profile.get("requires_sponsorship") else "No"
    if any(k in label for k in ("authorized to work", "legally authorized", "work authorization", "eligible to work")):
        return "Yes" if profile.get("work_authorized", True) else "No"
    if any(k in label for k in ("relocate", "relocation")):
        return "Yes" if profile.get("willing_to_relocate") else "No"
    if "notice period" in label:
        return profile.get("notice_period") or "Immediate"
    if any(k in label for k in ("current location", "location", "city", "based in", "where are you")):
        return profile.get("city") or None
    if any(k in label for k in ("salary", "compensation", "expected pay")):
        return profile.get("expected_salary") or "Negotiable"
    if any(k in label for k in (
        "current company", "recent company", "current employer",
        "recent employer", "company name", "employer name",
    )):
        return profile.get("currentCompany") or "Self-employed"
    if ("years" in label or "experience" in label) and "sponsor" not in label:
        return str(profile.get("years_of_experience") or "2")
    return None


async def _ask_claude_for_answer(question: str, cv_text: str, profile: dict) -> str:
    """Ask Claude for a short, honest answer to a custom application question,
    grounded in the candidate's actual CV/profile — never invents experience."""
    prompt = (
        "You are filling out a job application form on behalf of a candidate. "
        "Answer the question below with a SHORT, direct answer suitable for a "
        "single form field (usually one sentence or a few words). Ground your "
        "answer in the candidate's actual CV/profile below — for objective "
        "questions with a real answer in that data (years of experience, "
        "education, current role, skills, etc.), extract and use it directly "
        "rather than answering vaguely. For a genuinely open-ended question "
        "(e.g. 'why do you want this role'), you may write a brief, "
        "professional response grounded in what the CV actually shows about "
        "the candidate's background and its fit with the question — do not "
        "invent employers, titles, achievements, or experience that aren't in "
        "the CV. If the question is asking for consent to standard data "
        "privacy/GDPR processing (mentions privacy, GDPR, or data "
        "protection) — that's boilerplate required to submit any "
        "application, not a substantive legal question — answer 'I agree'. "
        "Never guess on questions with real legal or eligibility "
        "consequences (work authorization, sponsorship, criminal history, "
        "prior termination, non-competes, background checks, drug testing, "
        "and similar) — if the profile data above doesn't cover it, answer "
        "honestly with 'Not specified' rather than guessing Yes or No. This "
        "application is submitted automatically with no human review step, "
        "so a guessed answer here becomes a false statement submitted to "
        "the employer under the candidate's real name.\n\n"
        f"Question: {question}\n\n"
        "Candidate profile:\n"
        f"- Years of experience: {profile.get('years_of_experience') or 'unknown'}\n"
        f"- Expected salary: {profile.get('expected_salary') or 'unknown'}\n"
        f"- Notice period: {profile.get('notice_period') or 'unknown'}\n"
        f"- Highest education: {profile.get('highest_education') or 'unknown'}\n\n"
        f"CV:\n{(cv_text or '')[:3000]}\n\n"
        "Return ONLY the answer text — no explanation, no quotes, no markdown."
    )
    try:
        message = await asyncio.to_thread(
            _claude_client.messages.create,
            model="claude-haiku-4-5-20251001",
            max_tokens=100,
            messages=[{"role": "user", "content": prompt}],
        )
        answer = message.content[0].text.strip()
        print(f"[ats-form] Claude answered {question!r} -> {answer!r}")
        return answer[:500] if answer else "N/A"
    except Exception as e:
        print(f"[ats-form] Claude question-answer failed for {question!r}: {e}")
        return "N/A"


async def _ask_claude_to_pick_option(question: str, options: list[str], cv_text: str, profile: dict) -> str | None:
    """Last-resort fallback for a select-type custom question whose fast-path/
    Claude free-text answer didn't match any real option — asks Claude to
    pick one of the actual option labels instead of defaulting to a
    positional guess (e.g. option index 1), which can land on something
    semantically unrelated to the real answer (a Yes/No option for a
    field that was actually asking for a company name, for instance)."""
    prompt = (
        "You are filling out a dropdown field on a job application. Pick "
        "EXACTLY one of the listed options that best answers the question, "
        "based on the candidate's CV/profile below. Return ONLY the option "
        "text, copied exactly as listed — no explanation, no extra words.\n\n"
        f"Question: {question}\n\n"
        f"Options: {options}\n\n"
        f"Candidate current company: {profile.get('currentCompany') or 'unknown'}\n"
        f"Years of experience: {profile.get('years_of_experience') or 'unknown'}\n\n"
        f"CV:\n{(cv_text or '')[:2000]}"
    )
    try:
        message = await asyncio.to_thread(
            _claude_client.messages.create,
            model="claude-haiku-4-5-20251001",
            max_tokens=50,
            messages=[{"role": "user", "content": prompt}],
        )
        picked = message.content[0].text.strip()
        if picked in options:
            print(f"[ats-form] Claude picked option {picked!r} for {question!r}")
            return picked
        print(f"[ats-form] Claude's pick {picked!r} isn't one of the listed options — ignoring")
        return None
    except Exception as e:
        print(f"[ats-form] Claude option-pick failed for {question!r}: {e}")
        return None


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
    profile: dict | None = None,
    cv_text: str = "",
) -> dict:
    """Fill ATS application form using Playwright."""

    print("[ats-form] fill_ats_form called")
    print(f"[ats-form] url={apply_url}")
    print(f"[ats-form] cv_bytes length={len(cv_bytes)}")
    print(f"[ats-form] first_name={first_name} last_name={last_name} email={email}")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False, prefix="cv_") as tmp:
        tmp.write(cv_bytes)
        cv_path = tmp.name

    print(f"[ats-form] CV written to temp file: {cv_path}")

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-accelerated-2d-canvas",
                    "--no-first-run",
                    "--no-zygote",
                    "--disable-gpu",
                    "--window-size=1920,1080",
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

            # Apply stealth patches BEFORE any navigation so fingerprint checks
            # during page load see a clean browser environment.
            await stealth_async(page)
            print("[ats-form] Stealth mode enabled")

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
            if "greenhouse.io" in apply_url:
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

            if "lever.co" in apply_url:
                result = await _fill_lever_form(
                    page, first_name, last_name, email, phone, cv_path, cover_letter, linkedin_url,
                    profile or {},
                )
            else:
                result = await _fill_form_fields(
                    page, first_name, last_name, email, phone, cv_path, cover_letter, linkedin_url,
                    profile or {}, cv_text,
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
    profile: dict,
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

    # Current location — required on many Lever boards; leaving it empty can
    # trigger "There was an error verifying your application" on submit.
    location = (profile or {}).get("city") or "Israel"
    await _try_fill(
        'input[name="location"], input[placeholder*="location" i], input[placeholder*="city" i]',
        location,
        "location",
    )

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

    # SAP-specific "Are you a current SAP employee?" dropdown — answered
    # explicitly (rather than relying on the generic Yes/No fallback below)
    # since a required field left on its default/blank value can be exactly
    # what triggers a Lever verification error on submit.
    #
    # "SAP" appears in the field's LABEL, not in the select's own options
    # (which are just "Select.../No/Yes") — get_by_label is the correct,
    # purpose-built way to find a control by its associated label text, so
    # it's tried first.
    sap_done = False
    try:
        sap_label_locator = page.get_by_label("Are you a current SAP employee?")
        if await sap_label_locator.count() > 0:
            await sap_label_locator.select_option(label="No")
            filled.append("sap_employee_status")
            print("[ats-form] Lever: SAP status set to No")
            sap_done = True
    except Exception as e:
        print(f"[ats-form] Lever: get_by_label SAP lookup failed: {e}")

    if not sap_done:
        try:
            sap_select = await page.query_selector('select[name*="sap" i], select[id*="sap" i]')
            if not sap_select:
                for sel in await page.query_selector_all("select"):
                    sel_id = await sel.get_attribute("id") or ""
                    label_text = ""
                    if sel_id:
                        label_el = await page.query_selector(f'label[for="{sel_id}"]')
                        if label_el:
                            label_text = (await label_el.inner_text()).strip().lower()

                    # Collect option texts with an explicit loop, not a
                    # generator expression — `await` inside a generator's
                    # element clause can't be consumed by a plain str.join()
                    # (this was the "can only join an iterable" bug).
                    option_text_parts = []
                    for opt in await sel.query_selector_all("option"):
                        option_text_parts.append((await opt.inner_text()).strip().lower())
                    option_texts = " ".join(option_text_parts)

                    if "sap" in label_text or "employee" in label_text or "sap" in option_texts:
                        sap_select = sel
                        break
            if sap_select:
                for opt in await sap_select.query_selector_all("option"):
                    if (await opt.inner_text()).strip().lower() == "no":
                        val = await opt.get_attribute("value") or ""
                        await sap_select.select_option(value=val)
                        filled.append("sap_employee_status")
                        print("[ats-form] Lever: SAP status set to No")
                        break
        except Exception as e:
            print(f"[ats-form] Lever: SAP employee status field error: {e}")

    # Dropdowns — pick "No" for employee-status questions, first option otherwise
    try:
        selects = await page.query_selector_all("select")
        for select in selects:
            options = await select.query_selector_all("option")
            picked = False
            for opt in options:
                text = (await opt.inner_text()).strip().lower()
                val = await opt.get_attribute("value") or ""
                if text == "no":
                    await select.select_option(value=val)
                    picked = True
                    break
            if not picked and len(options) > 1:
                val = await options[1].get_attribute("value") or ""
                if val:
                    await select.select_option(value=val)
    except Exception:
        pass

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
            return {
                "success": True,
                "filled": filled,
                "ats": "lever",
                "message": "Submitted (no explicit confirmation)",
            }
    except Exception as e:
        print(f"[ats-form] Lever: submit click error: {e}")

    return {"success": False, "error": "Lever submit failed", "filled": filled}


async def _fill_greenhouse_form(
    page,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    cv_path: str,
    cover_letter: str,
    linkedin_url: str,
    profile: dict,
    cv_text: str,
) -> dict:
    """Fill a Greenhouse-shaped application form: name/email, phone+country,
    location, resume, cover letter, custom questions, and EEO fields.

    Selectors here (#first_name, #candidate-location, question_* ids, the
    numeric EEO ids) are Greenhouse's specifically — this is also the fill
    function invoked for workable/bamboohr/comeet/teamtailor/ashby since
    none of those get their own dedicated handling, but the DOM it targets
    is Greenhouse's. Submit + confirmation detection happens in the caller,
    unchanged.

    Returns {"filled": [...], "errors": [...]} on the normal path, or
    {"early_result": {...full result dict...}} if an unsolvable CAPTCHA
    means there's no point continuing to submit.
    """

    filled: list[str] = []
    errors: list[str] = []

    # Step 1: let the form finish rendering before touching any field —
    # Greenhouse's embedded form does its own client-side init after load.
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(1000)

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

    # Country: React-controlled autocomplete — must use keyboard events so React
    # registers state changes. fill() bypasses synthetic events and gets overwritten.
    try:
        country_el = await page.query_selector('#country, input[id="country"]')
        if country_el:
            menu_opened_via_control = False

            # Confirmed from the actual rendered HTML: this board's react-select
            # dropdown opens via a dedicated toggle button
            # (aria-label="Toggle flyout"), not generically from clicking
            # anywhere in the .select__control container — try the real
            # trigger first.
            toggle_btn = page.locator('button[aria-label="Toggle flyout"]').first
            if await toggle_btn.count() > 0:
                await toggle_btn.click()
                await page.wait_for_timeout(500)
                print("[ats-form] Clicked Toggle flyout button")

                await page.keyboard.type("Israel", delay=50)
                await page.wait_for_timeout(500)

                israel_opt = page.locator(".select__option").filter(has_text="Israel").first
                if await israel_opt.count() > 0:
                    await israel_opt.click()
                    print("[ats-form] Selected Israel from dropdown (Toggle flyout)")
                else:
                    await page.keyboard.press("Enter")
                    print("[ats-form] Pressed Enter for Israel (Toggle flyout, no exact option match)")
                menu_opened_via_control = True
            else:
                print("[ats-form] Toggle flyout button not found — trying select__control click")

            # Screenshot evidence from an earlier attempt showed the
            # react-select menu never opens from typing into #country alone —
            # react-select opens its menu from a click on the "control" div
            # (the whole widget's clickable surface), not necessarily from
            # focusing/typing into the underlying input. Try that next if the
            # toggle button above wasn't found.
            country_control = page.locator('.select__control, [class*="select__control"]').first
            if not menu_opened_via_control and await country_control.count() > 0:
                await country_control.click()
                await page.wait_for_timeout(500)
                print("[ats-form] Clicked react-select control")

                menu = page.locator(".select__menu")
                if await menu.count() > 0:
                    print("[ats-form] Menu opened after control click")
                    menu_opened_via_control = True
                    await page.keyboard.type("Israel", delay=50)
                    await page.wait_for_timeout(500)

                    israel_opt = page.locator(".select__option").filter(has_text="Israel").first
                    if await israel_opt.count() > 0:
                        await israel_opt.click()
                        print("[ats-form] Selected Israel via react-select control click")
                    else:
                        await page.keyboard.press("Enter")
                        print(
                            "[ats-form] Country: pressed Enter after control-click "
                            "typing (no exact Israel option match)"
                        )
                else:
                    print("[ats-form] Menu did not open after control click — falling back to input click + type")
            elif not menu_opened_via_control:
                print("[ats-form] No select__control found — using input-based approach")

            if not menu_opened_via_control:
                print("[ats-form] Country: clicking field")
                await country_el.click()
                await page.wait_for_timeout(300)

                value_before_type = await country_el.input_value()
                print(f"[ats-form] Country value before type: {value_before_type!r}")

                await page.keyboard.press("Control+a")
                await page.keyboard.press("Backspace")
                await page.wait_for_timeout(200)
                print("[ats-form] Country: typing Israel")
                for char in "Israel":
                    await page.keyboard.type(char, delay=80)
                await page.wait_for_timeout(1500)

                value_after_type = await country_el.input_value()
                print(f"[ats-form] Country value after typing: {value_after_type!r}")

                # The broad li/[class*="option"] selectors tried previously
                # matched unrelated page content (job description bullet
                # points are <li> elements too) — find every element that
                # actually contains the text "Israel" anywhere on the page,
                # independent of any selector guess, to identify what the
                # real dropdown option looks like structurally.
                try:
                    israel_elements = await page.evaluate(
                        """() => {
                            const walker = document.createTreeWalker(
                                document.body,
                                NodeFilter.SHOW_TEXT,
                                null
                            );
                            const results = [];
                            let node;
                            while (node = walker.nextNode()) {
                                if (node.textContent.includes('Israel')) {
                                    const el = node.parentElement;
                                    results.push({
                                        tag: el.tagName,
                                        class: el.className,
                                        role: el.getAttribute('role'),
                                        text: node.textContent.trim().slice(0, 50),
                                    });
                                }
                            }
                            return results.slice(0, 10);
                        }"""
                    )
                    print(f"[ats-form] Elements containing Israel: {israel_elements}")
                except Exception as e:
                    print(f"[ats-form] Could not scan for Israel text: {e}")

                try:
                    focused = await page.evaluate(
                        """() => {
                            const el = document.activeElement;
                            return {
                                tag: el.tagName,
                                id: el.id,
                                class: el.className,
                                role: el.getAttribute('role'),
                            };
                        }"""
                    )
                    print(f"[ats-form] Focused element: {focused}")
                except Exception as e:
                    print(f"[ats-form] Could not read focused element: {e}")

                try:
                    os.makedirs("/app/screenshots", exist_ok=True)
                    await page.screenshot(path="/app/screenshots/country_dropdown.png")
                    print("[ats-form] Country dropdown screenshot saved")
                except Exception as e:
                    print(f"[ats-form] Could not save country dropdown screenshot: {e}")

                try:
                    await page.wait_for_selector(".select__menu, .select__menu-list", timeout=3000)
                    print("[ats-form] React-select menu appeared")
                except Exception:
                    print("[ats-form] React-select menu timeout — .select__menu never appeared")

                react_select_options = await page.locator(".select__option").all()
                print(f"[ats-form] React-select options: {len(react_select_options)}")
                for opt in react_select_options[:10]:
                    try:
                        opt_text = await opt.inner_text()
                    except Exception:
                        opt_text = "<unreadable>"
                    print(f"[ats-form]   react-select option: {opt_text!r}")

                option = None
                israel_opt = page.locator(".select__option").filter(has_text="Israel").first
                if await israel_opt.count() > 0:
                    option = israel_opt
                if option:
                    await option.click()
                    await page.wait_for_timeout(400)
                    val = await page.input_value("#country")
                    print(f"[ats-form] Country after dropdown click: '{val}'")
                else:
                    await page.keyboard.press("ArrowDown")
                    await page.wait_for_timeout(200)
                    await page.keyboard.press("Enter")
                    await page.wait_for_timeout(400)
                    val = await page.input_value("#country")
                    print(f"[ats-form] Country after ArrowDown+Enter: '{val}'")

            # react-select-style widgets often keep the value that actually
            # gets submitted on a second, unlabeled sibling input (the
            # library's own hidden form-value mirror) separate from the
            # visible #country search box — sync it in case our selection
            # above only updated the visible one.
            try:
                hidden_sync_result = await page.evaluate(
                    """() => {
                        const country = document.querySelector('#country');
                        if (!country) return 'no_country_el';
                        const parent = country.parentElement;
                        if (!parent) return 'no_parent';
                        const synced = [];
                        parent.querySelectorAll('input').forEach(inp => {
                            if (inp !== country && !inp.id) {
                                inp.value = country.value;
                                inp.dispatchEvent(new Event('input', { bubbles: true }));
                                inp.dispatchEvent(new Event('change', { bubbles: true }));
                                synced.push(inp.name || '(no name)');
                            }
                        });
                        country.dispatchEvent(new Event('input', { bubbles: true }));
                        country.dispatchEvent(new Event('change', { bubbles: true }));
                        return synced;
                    }"""
                )
                print(f"[ats-form] Country hidden-sibling-input sync: {hidden_sync_result}")
            except Exception as e:
                print(f"[ats-form] Country hidden-sibling-input sync failed: {e}")

            # Every input on the page that either has a value or has no id —
            # narrower than the full ALL-inputs dump used for custom
            # questions, scoped to exactly what's relevant here: did
            # anything actually pick up "Israel" anywhere in the DOM.
            try:
                all_inputs_after_country = await page.evaluate(
                    """() => Array.from(document.querySelectorAll('input'))
                        .map(el => ({id: el.id, val: el.value, type: el.type}))
                        .filter(x => x.val || !x.id)
                        .slice(0, 10)"""
                )
                print(f"[ats-form] Inputs after country: {all_inputs_after_country}")
            except Exception as e:
                print(f"[ats-form] Could not dump inputs after country: {e}")

            final_val = await page.input_value("#country")
            if not final_val:
                # Last resort: fire React's native value setter + synthetic events
                await page.evaluate("""() => {
                    const input = document.getElementById('country');
                    if (!input) return;
                    const setter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype, 'value'
                    ).set;
                    setter.call(input, 'Israel');
                    input.dispatchEvent(new Event('input', {bubbles: true}));
                    input.dispatchEvent(new Event('change', {bubbles: true}));
                    input.dispatchEvent(new Event('blur', {bubbles: true}));
                }""")
                await page.wait_for_timeout(400)
                final_val = await page.input_value("#country")
                print(f"[ats-form] Country after React event injection: '{final_val}'")

            print(f"[ats-form] FINAL country value: '{final_val}'")
            filled.append("country")
    except Exception as e:
        print(f"[ats-form] Country field error: {e}")

    # Candidate location — separate free-text field some Greenhouse boards show
    # alongside (not instead of) the country autocomplete above.
    city = profile.get("city", "") or ""
    country_name = profile.get("country", "Israel")
    location_text = f"{city}, {country_name}".strip(", ")
    candidate_location_found = False
    try:
        location_field = page.locator('#candidate-location')
        if await location_field.count() > 0:
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
    if not candidate_location_found:
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
    try:
        country_select = await page.query_selector('select[name="phone_country_code"]')
        if country_select:
            await country_select.select_option(value="IL")
            print("[ats-form] Set phone country code to IL (select dropdown)")
    except Exception:
        pass

    # Phone: ITI library wraps the tel input with a country-flag picker.
    # Only interact if we actually have a phone number — touching ITI with no
    # number can leave the field in a broken state.
    if not phone:
        print("[ats-form] No phone value — leaving phone field untouched")
    else:
        # Normalize to local format: ITI manages the country code separately
        clean_phone = phone
        if clean_phone.startswith("+972"):
            clean_phone = "0" + clean_phone[4:]
        elif clean_phone.startswith("972"):
            clean_phone = "0" + clean_phone[3:]

        try:
            # Click the phone field first — some ITI builds only fully
            # initialize (and register the instance getInstance() looks up)
            # once the input has actually received focus.
            phone_field_for_iti = page.locator('#phone, input[type="tel"]')
            if await phone_field_for_iti.count() > 0:
                await phone_field_for_iti.first.click()
                await page.wait_for_timeout(500)

            iti_result = await page.evaluate("""() => {
                const phoneEl = document.querySelector('#phone, input[type="tel"]');
                if (!phoneEl) return 'no_phone_el';

                // Primary: the documented API, keyed to this exact element.
                let iti = window.intlTelInputGlobals
                    && window.intlTelInputGlobals.getInstance(phoneEl);

                // Fallback: getInstance() relies on a data-intl-tel-input-id
                // attribute being set on the input, which some builds omit —
                // in that case, reach into the instances collection directly
                // and just take the first (usually only) one on the page.
                if (!iti && window.intlTelInputGlobals && window.intlTelInputGlobals.instances) {
                    const keys = Object.keys(window.intlTelInputGlobals.instances);
                    if (keys.length > 0) iti = window.intlTelInputGlobals.instances[keys[0]];
                }

                // Some builds stash the instance directly on the element
                // instead of (or in addition to) the global registry.
                if (!iti && phoneEl._iti) {
                    iti = phoneEl._iti;
                }

                if (!iti) {
                    const flagBtn = document.querySelector(
                        '.iti__flag-container, .iti__selected-flag'
                    );
                    return flagBtn ? 'no_instance_flag_found' : 'no_instance_no_flag';
                }
                iti.setCountry('il');
                return 'set';
            }""")
            await page.wait_for_timeout(300)
            print(f"[ats-form] Set ITI country to IL (result: {iti_result})")

            flag_count = await page.locator(
                '.iti__flag, .iti__selected-flag, [class*="iti__flag"]'
            ).count()
            print(f"[ats-form] ITI flag elements: {flag_count}")

            dial_code_locator = page.locator('.iti__selected-dial-code')
            if await dial_code_locator.count() > 0:
                dial_code_text = await dial_code_locator.first.inner_text()
                print(f"[ats-form] Phone dial code: {dial_code_text!r}")

            if flag_count == 0:
                # The intlTelInputGlobals JS API found nothing to call —
                # either the widget wasn't initialized yet or this board
                # uses different class names entirely. Fall back to driving
                # it as a real user would: click each candidate container
                # until one opens a dropdown, then click the Israel entry.
                print("[ats-form] WARNING: ITI flag not found via JS API — trying interactive click fallback")

                israel_selected = False
                # Confirmed from the actual rendered HTML: this ITI build uses
                # the newer v18+ markup (button.iti__selected-country +
                # ul.iti__country-list), not the older .iti__flag-container/
                # .iti__country names the generic fallback below was written
                # against — try the real selectors first.
                try:
                    iti_country_btn = page.locator(
                        'button.iti__selected-country, button[aria-label="Select country"]'
                    ).first
                    if await iti_country_btn.count() > 0:
                        await iti_country_btn.click()
                        await page.wait_for_timeout(500)
                        print("[ats-form] Clicked ITI flag button (iti__selected-country)")

                        search = page.locator(
                            '#iti-0__search-input, input[id$="__search-input"]'
                        ).first
                        if await search.count() > 0:
                            await search.type("Israel", delay=50)
                            await page.wait_for_timeout(500)
                        else:
                            print("[ats-form] ITI: no search input found after opening country list")

                        israel_item = page.locator("ul.iti__country-list li").filter(has_text="Israel").first
                        if await israel_item.count() > 0:
                            await israel_item.click()
                            await page.wait_for_timeout(200)
                            print("[ats-form] Selected Israel in ITI (iti__country-list)")
                            israel_selected = True
                        else:
                            print("[ats-form] ITI: no Israel item found in iti__country-list")
                    else:
                        print("[ats-form] ITI: button.iti__selected-country not found")
                except Exception as e:
                    print(f"[ats-form] ITI: iti__selected-country flow failed: {e}")

                if not israel_selected:
                    iti_selectors = [
                        '.iti__flag-container',
                        '.iti__selected-flag',
                        '[class*="iti__flag"]',
                        '.iti',
                        '#phone',  # click phone first — some ITI builds only mount the widget on focus
                    ]
                    for iti_sel in iti_selectors:
                        try:
                            el = await page.query_selector(iti_sel)
                            if not el:
                                continue
                            await el.click()
                            await page.wait_for_timeout(300)
                            israel_option = await page.query_selector(
                                '[data-country-code="il"], li:has-text("Israel"), '
                                '.iti__country:has-text("Israel")'
                            )
                            if israel_option:
                                await israel_option.click()
                                await page.wait_for_timeout(200)
                                print(f"[ats-form] ITI: selected Israel via {iti_sel!r} click")
                                israel_selected = True
                                break
                            print(f"[ats-form] ITI: clicked {iti_sel!r}, no Israel option found in dropdown")
                        except Exception as e:
                            print(f"[ats-form] ITI: {iti_sel!r} click failed: {e}")

                if not israel_selected:
                    # None of our selectors matched a clickable "Israel"
                    # element in the opened list — instead of matching
                    # markup, drive the dropdown's own keyboard type-ahead
                    # (the same accessibility feature a native <select>
                    # supports): open the flag, type the country name, and
                    # press Enter to select whatever it lands on.
                    try:
                        flag = page.locator('.iti__selected-flag').first
                        if await flag.count() > 0:
                            await flag.click()
                            await page.wait_for_timeout(500)
                            await page.keyboard.type("Israel")
                            await page.wait_for_timeout(500)
                            await page.keyboard.press("Enter")
                            await page.wait_for_timeout(300)
                            print("[ats-form] ITI: selected Israel via keyboard type-ahead")
                        else:
                            print("[ats-form] ITI: keyboard fallback skipped — .iti__selected-flag not found")
                    except Exception as e:
                        print(f"[ats-form] ITI: keyboard type-ahead fallback failed: {e}")

                flag_count = await page.locator(
                    '.iti__flag, .iti__selected-flag, [class*="iti__flag"]'
                ).count()
                print(f"[ats-form] ITI flag elements after fallback: {flag_count}")
        except Exception as e:
            print(f"[ats-form] ITI country set error: {e}")

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
    for q in custom_questions:
        q_id = await q.get_attribute("id") or ""
        tag_name = await q.evaluate("el => el.tagName.toLowerCase()")
        q_type = await q.get_attribute("type") or "text"

        label = await page.query_selector(f'label[for="{q_id}"]')
        label_text = (await label.inner_text()).strip() if label else ""
        print(f"[ats-form] Custom question: {q_id} ({tag_name}) — {label_text}")

        if tag_name == "select":
            # Dropdown-style custom questions (e.g. "How many years of X
            # experience?") were previously skipped entirely — the selector
            # above only matched input/textarea, so a required select-type
            # question stayed on its blank/placeholder option forever.
            if not label_text:
                print(f"[ats-form] Skipping {q_id}: no label text found")
                continue

            answer = _fast_path_answer(label_text, profile, linkedin_url)
            if answer is None:
                print(f"[ats-form] No fast-path match for {label_text!r} — asking Claude")
                answer = await _ask_claude_for_answer(label_text, cv_text, profile)

            try:
                options = await q.evaluate(
                    "el => Array.from(el.options).map(o => ({value: o.value, text: o.text}))"
                )
                print(f"[ats-form] Select options for {q_id}: {options}")
                option_labels = [o["text"].strip() for o in options]

                match = next(
                    (o for o in option_labels if o.lower() == answer.lower()), None
                )
                if not match:
                    # `len(o) >= 4` guards the o-in-answer direction only —
                    # without it, a short generic option like "Yes"/"No" can
                    # match by pure coincidence whenever the answer string
                    # happens to contain that substring anywhere (e.g. a
                    # free-text company-name answer that isn't Yes/No at all
                    # still getting matched to a "Yes" option). The
                    # answer-in-o direction stays unguarded since the
                    # fast-path answers that are intentionally short
                    # ("Yes"/"No") are meant to match this way.
                    match = next(
                        (o for o in option_labels
                         if answer.lower() in o.lower() or (len(o) >= 4 and o.lower() in answer.lower())),
                        None,
                    )
                if not match:
                    print(
                        f"[ats-form] No text match for {label_text!r} answer {answer!r} "
                        f"among options {option_labels!r} — this may not be the kind of "
                        f"question the answer assumed; asking Claude to pick an option"
                    )
                    match = await _ask_claude_to_pick_option(label_text, option_labels, cv_text, profile)
                if not match and len(option_labels) > 1:
                    match = option_labels[1]  # last resort — skip index 0, usually a "Select..." placeholder
                if match:
                    await q.select_option(label=match)
                    # select_option() already dispatches native events, but
                    # dispatch an explicit change too — cheap insurance given
                    # how many "reported success, React never saw it" cases
                    # showed up for other field types in this exact file.
                    matched_option = next((o for o in options if o["text"].strip() == match), None)
                    if matched_option:
                        await q.evaluate(
                            """(el, val) => {
                                el.value = val;
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                            }""",
                            matched_option["value"],
                        )
                    filled.append(f"custom_{q_id}")
                    print(f"[ats-form] Filled custom select {q_id} ({label_text!r}): {match!r}")
                else:
                    print(f"[ats-form] Custom select {q_id} has no options to choose from")
            except Exception as e:
                print(f"[ats-form] Could not fill custom select {q_id}: {e}")
            continue

        if q_type not in ("file", "checkbox", "radio", "hidden"):
            if not label_text:
                # No label to reason about — skip rather than guess.
                print(f"[ats-form] Skipping {q_id}: no label text found")
                continue

            answer = _fast_path_answer(label_text, profile, linkedin_url)
            if answer is None:
                print(f"[ats-form] No fast-path match for {label_text!r} — asking Claude")
                answer = await _ask_claude_for_answer(label_text, cv_text, profile)

            try:
                await q.click()
                await _apply_react_value(page, q, answer)
                filled.append(f"custom_{q_id}")
                print(f"[ats-form] Filled custom question {q_id} ({label_text!r}): {answer!r}")
            except Exception as e:
                print(f"[ats-form] Could not fill custom question {q_id}: {e}")

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

    try:
        gdpr = await page.query_selector(
            'input[name*="gdpr"], input[name*="consent"], input[id*="gdpr"], input[id*="consent"]'
        )
        if gdpr:
            await gdpr.check()
            filled.append("gdpr_consent")
            print("[ats-form] Checked GDPR consent")
    except Exception:
        pass

    # ── "How did you hear about us?" dropdown ────────────────────────────────

    try:
        selects = await page.query_selector_all("select")
        for select in selects:
            label = (await select.get_attribute("name") or "").lower()
            if "hear" in label or "source" in label or "referred" in label:
                options = await select.query_selector_all("option")
                for opt in options:
                    val = await opt.get_attribute("value") or ""
                    text = await opt.inner_text()
                    if "other" in text.lower() or "linkedin" in text.lower():
                        await select.select_option(value=val)
                        filled.append("referral_source")
                        break
                else:
                    for opt in options[1:]:
                        val = await opt.get_attribute("value") or ""
                        if val:
                            await select.select_option(value=val)
                            break
    except Exception as e:
        print(f"[ats-form] referral select: {e}")

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
    # self-identify" is always one of the options Greenhouse itself offers,
    # so selecting it never fabricates or guesses an actual answer.
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
                    const target = decline || opts[1];
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
            await page.wait_for_timeout(500)

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
                # Skip blank/placeholder-looking entries rather than blindly
                # clicking whichever option happens to be first — for a
                # div-based listbox a "Select..." placeholder can render as
                # a real, clickable option, not just an implicit unselected
                # native-<select> default. Blindly clicking index 0 here
                # could otherwise assign a real (and wrong) demographic
                # answer instead of leaving/declining the question.
                picked = False
                for i in range(option_count):
                    text = (await option_locator.nth(i).inner_text()).strip()
                    if not text or text.lower() in ("select", "select...", "choose", "choose one", "please select"):
                        continue
                    await option_locator.nth(i).click()
                    filled.append(f"eeo_{field_id}")
                    print(f"[ats-form] EEO {field_id}: clicked option {text!r} (React dropdown, no decline option found)")
                    picked = True
                    break
                if not picked:
                    print(f"[ats-form] EEO {field_id}: no usable option found among {option_count} candidates")

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
    profile: dict,
    cv_text: str,
) -> dict:
    """Fill the form via _fill_greenhouse_form, then submit and detect the
    outcome. Split in two so filling and submit-confirmation are each their
    own function instead of one 1000+ line block."""

    fill_outcome = await _fill_greenhouse_form(
        page, first_name, last_name, email, phone, cv_path, cover_letter, linkedin_url, profile, cv_text,
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

        # ── Greenhouse email verification challenge ───────────────────────────
        verification_signals = [
            "security code",
            "verification code",
            "enter the code",
            "copy and paste this code",
            "check your email",
            "sent you a code",
        ]
        if any(s in page_text_lower for s in verification_signals):
            print("[ats-form] Greenhouse email verification step detected")
            return {
                "success": True,
                "status": "pending_verification",
                "filled": filled,
                "message": "Greenhouse sent a verification code to your email. Check your inbox and enter the code to complete your application.",
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
        # value lands here rather than being guessed as a success — genuinely
        # inconclusive outcomes surface as pending_verification (not failed)
        # via ats_apply.py's unknown_state handling instead.
        print("[ats-form] No confirmation signals found — unknown state")
        return {
            "success": False,
            "error": "unknown_state",
            "filled": filled,
            "message": "Could not confirm if application was submitted. Check your email or the job portal.",
        }

    except Exception as e:
        return {"success": False, "error": f"Submit failed: {str(e)}", "filled": filled, "errors": errors}
