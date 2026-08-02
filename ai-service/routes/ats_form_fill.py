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
        "single form field (usually one sentence or a few words). Only use "
        "information present in the candidate's CV or profile below — never "
        "invent facts. If the question can't be answered from the given "
        "information, give a brief, honest answer such as 'N/A' or 'Not specified'.\n\n"
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

            screenshot_path = f"/tmp/ats_load_{int(time.time())}.png"
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
    """Fill form fields using common CSS selectors."""

    filled = []
    errors = []

    async def fill_field(selectors: list[str], value: str, field_name: str, react_sync: bool = False) -> bool:
        for selector in selectors:
            try:
                el = await page.wait_for_selector(selector, timeout=3000, state="visible")
                if el:
                    if react_sync:
                        # React value-tracker trick instead of .fill() — see react_fill for why.
                        await el.click()
                        await _apply_react_value(page, el, value)
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

    # ── Standard fields ──────────────────────────────────────────────────────

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
            await country_el.click()
            await page.wait_for_timeout(300)
            await page.keyboard.press("Control+a")
            await page.keyboard.press("Backspace")
            await page.wait_for_timeout(200)
            for char in "Israel":
                await page.keyboard.type(char, delay=80)
            await page.wait_for_timeout(1500)

            option = await page.query_selector(
                'li.select-option:has-text("Israel"), '
                '[role="option"]:has-text("Israel"), '
                'li:has-text("Israel"), '
                '.dropdown-item:has-text("Israel")'
            )
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
    try:
        location_field = page.locator('#candidate-location')
        if await location_field.count() > 0:
            city = profile.get("city", "") or ""
            country_name = profile.get("country", "Israel")
            location_text = f"{city}, {country_name}".strip(", ")
            await _react_fill(page, "#candidate-location", location_text)
            filled.append("candidate_location")
            print(f"[ats-form] Filled candidate-location: {location_text}")

            # Verify the value actually stuck — some Greenhouse boards wrap
            # this in a JS-controlled autocomplete that silently reverts fill().
            val = await page.locator("#candidate-location").input_value()
            print(f"[ats-form] candidate-location value: {val!r}")
    except Exception as e:
        print(f"[ats-form] candidate-location field error: {e}")

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
            await page.evaluate("""() => {
                const phoneEl = document.querySelector('#phone, input[type="tel"]');
                if (!phoneEl) return;
                const iti = window.intlTelInputGlobals
                    && window.intlTelInputGlobals.getInstance(phoneEl);
                if (iti) { iti.setCountry('il'); }
            }""")
            await page.wait_for_timeout(300)
            print("[ats-form] Set ITI country to IL")
        except Exception as e:
            print(f"[ats-form] ITI country set error: {e}")

        try:
            phone_el = await page.query_selector(
                'input[id="phone"], input[type="tel"], input[id*="phone"]'
            )
            if phone_el:
                await phone_el.click()
                await page.wait_for_timeout(200)
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

    # Try clicking the upload trigger button first (Greenhouse hides the real input)
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

    await upload_file([
        "#resume",
        'input[id="resume"]',
        'input[type="file"][name="resume"]',
        'input[type="file"][id*="resume"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"]',
    ], cv_path, "resume")

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

    custom_questions = await page.query_selector_all(
        'input[id^="question_"], textarea[id^="question_"]'
    )
    for q in custom_questions:
        q_id = await q.get_attribute("id") or ""
        q_type = await q.get_attribute("type") or "text"

        label = await page.query_selector(f'label[for="{q_id}"]')
        label_text = (await label.inner_text()).strip() if label else ""
        print(f"[ats-form] Custom question: {q_id} — {label_text}")

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
                "success": False,
                "error": "captcha_detected",
                "captcha": True,
                "captcha_type": captcha_type,
                "filled": filled,
                "message": f"Form has {captcha_type} — could not solve automatically",
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
    # Greenhouse renders these as native <select> elements with short numeric
    # ids (e.g. #430 gender, #431 race/ethnicity, #432 veteran status,
    # #433 disability status). These are voluntary EEO self-identification
    # questions — "Decline to self-identify" is always one of the options
    # Greenhouse itself offers, so selecting it never fabricates or guesses
    # an actual answer about the candidate.
    eeo_field_ids = ["430", "431", "432", "433", "434", "436"]
    decline_phrases = ("decline", "prefer not", "don't wish", "not to disclose")

    for field_id in eeo_field_ids:
        try:
            # CSS ID selectors can't start with a digit (#430 is invalid
            # syntax per the CSS spec) — these numeric Greenhouse field ids
            # need the attribute-selector form instead.
            select = page.locator(f'select[id="{field_id}"]')
            if await select.count() == 0:
                continue

            option_labels = await select.locator("option").all_inner_texts()
            decline_label = next(
                (label for label in option_labels if any(p in label.lower() for p in decline_phrases)),
                None,
            )

            try:
                if decline_label:
                    await select.select_option(label=decline_label)
                    print(f"[ats-form] EEO field {field_id}: selected {decline_label!r}")
                elif option_labels:
                    await select.select_option(index=0)
                    print(f"[ats-form] EEO field {field_id}: no decline option found, selected first option {option_labels[0]!r}")
                filled.append(f"eeo_{field_id}")
                continue
            except Exception as e:
                print(f"[ats-form] EEO field {field_id}: select_option failed ({e}), falling back to JS value set")

            # Fallback for boards where this is a JS/React-controlled select
            # that Playwright's select_option can't drive directly — force
            # the value and dispatch real events so the framework's state
            # actually updates (a bare `.value =` assignment gets silently
            # reverted otherwise, same lesson as the country field above).
            await page.evaluate(
                """(fieldId) => {
                    const select = document.getElementById(fieldId);
                    if (!select) return;
                    const options = Array.from(select.options);
                    const decline = options.find(o =>
                        o.text.toLowerCase().includes('decline') ||
                        o.text.toLowerCase().includes('prefer not') ||
                        o.text.toLowerCase().includes("don't wish") ||
                        o.text.toLowerCase().includes('not to disclose')
                    );
                    select.value = decline ? decline.value : (options[0] ? options[0].value : select.value);
                    select.dispatchEvent(new Event('input', { bubbles: true }));
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                field_id,
            )
            filled.append(f"eeo_{field_id}")
            print(f"[ats-form] EEO field {field_id}: set via JS fallback")
        except Exception as e:
            print(f"[ats-form] EEO field {field_id} error: {e}")

    # ── Verify React actually picked up our values ────────────────────────────
    # Reads element.value straight from the DOM by id — if this shows the
    # values we filled, React's controlled state genuinely updated; if it
    # shows blanks despite the fields visibly looking filled in a
    # screenshot, the value-tracker trick above didn't take for that field.
    try:
        react_values = await page.evaluate("""
            () => {
                const inputs = document.querySelectorAll(
                    'input[type="text"], input[type="email"], input[type="tel"]'
                );
                const result = {};
                inputs.forEach(el => {
                    if (el.id) result[el.id] = el.value;
                });
                return result;
            }
        """)
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
        await page.screenshot(path=f"/tmp/no_submit_{int(time.time())}.png", full_page=True)
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

        screenshot_path = f"/tmp/post_submit_{int(time.time())}.png"
        await page.screenshot(path=screenshot_path, full_page=True)
        print(f"[ats-form] Post-submit screenshot: {screenshot_path}")

        # Check for field validation errors
        error_elements = await page.locator(
            '.error, .field-error, [class*="error"], '
            '[aria-invalid="true"], .invalid-feedback'
        ).all()
        for el in error_elements:
            try:
                text = await el.inner_text()
                if text.strip():
                    print(f"[ats-form] VALIDATION ERROR: {text.strip()[:100]}")
            except Exception:
                pass

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
            err_screenshot_path = f"/tmp/form_error_{int(time.time())}.png"
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
