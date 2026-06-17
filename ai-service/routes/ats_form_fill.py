import os
import random
import tempfile
import time

from playwright.async_api import async_playwright
from playwright_stealth import stealth_async


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
                    page, first_name, last_name, email, phone, cv_path, cover_letter, linkedin_url
                )
            else:
                result = await _fill_form_fields(
                    page, first_name, last_name, email, phone, cv_path, cover_letter, linkedin_url
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
        print("[ats-form] hCaptcha detected — cannot auto-submit")
        return {
            "success": False,
            "error": "captcha_detected",
            "captcha": True,
            "captcha_type": "hcaptcha",
            "filled": filled,
            "message": "Form has hCaptcha — requires manual submission",
        }

    async def _check_success() -> dict | None:
        page_text = await page.inner_text("body")
        print(f"[ats-form] Lever: page text after submit:\n{page_text[:2000]}")
        if any(s in page_text.lower() for s in [
            "thank you", "application received", "successfully", "we'll be in touch"
        ]):
            return {"success": True, "filled": filled, "ats": "lever"}
        return None

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
) -> dict:
    """Fill form fields using common CSS selectors."""

    filled = []
    errors = []

    async def fill_field(selectors: list[str], value: str, field_name: str) -> bool:
        for selector in selectors:
            try:
                el = await page.wait_for_selector(selector, timeout=3000, state="visible")
                if el:
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
    ], first_name, "first_name")

    await _human_delay(page)
    await fill_field([
        "#last_name",
        'input[id="last_name"]',
        'input[name="last_name"]',
        'input[placeholder*="Last"]',
        'input[id="last-name"]',
        'input[id*="last_name"]',
    ], last_name, "last_name")

    await _human_delay(page)
    await fill_field([
        "#email",
        'input[id="email"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[id*="email"]',
    ], email, "email")

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
            label_lower = label_text.lower()
            if any(k in label_lower for k in ("linkedin", "linkedin profile", "linkedin url")):
                answer = linkedin_url or "N/A"
            elif any(k in label_lower for k in ("github", "portfolio", "website", "url")):
                answer = "N/A"
            elif any(k in label_lower for k in ("salary", "expected", "compensation")):
                answer = "Negotiable"
            elif any(k in label_lower for k in ("years", "experience")):
                answer = "2"
            else:
                answer = "Yes"
            try:
                await q.fill(answer)
                filled.append(f"custom_{q_id}")
                print(f"[ats-form] Filled custom question {q_id} ({label_text!r}): {answer!r}")
            except Exception as e:
                print(f"[ats-form] Could not fill custom question {q_id}: {e}")

    # ── CAPTCHA check (visible challenges only) — bail before submit ─────────
    # Only block on user-visible challenges. reCAPTCHA v3 (invisible) runs silently
    # in the background and does NOT require user interaction — Greenhouse uses it on
    # all forms. Matching `iframe[src*="recaptcha"]` or `input[name="g-recaptcha-response"]`
    # catches v3 and produces false positives that block every Greenhouse submission.

    captcha_el = await page.query_selector(
        '.g-recaptcha[data-sitekey]:not([data-size="invisible"]), '
        'input[name="h-captcha-response"], .h-captcha, iframe[src*="hcaptcha"]'
    )
    if captcha_el:
        name_attr = await captcha_el.get_attribute("name") or ""
        src_attr = await captcha_el.get_attribute("src") or ""
        class_attr = await captcha_el.get_attribute("class") or ""
        captcha_type = "hcaptcha" if "hcaptcha" in (name_attr + src_attr + class_attr) else "recaptcha"
        print(f"[ats-form] CAPTCHA detected: {captcha_type}")
        return {
            "success": False,
            "error": "captcha_detected",
            "captcha": True,
            "captcha_type": captcha_type,
            "filled": filled,
            "message": f"Form has {captcha_type} — requires manual submission",
        }

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
        url_before = page.url
        print(f"[ats-form] URL before submit: {url_before}")
        print("[ats-form] Clicking submit button...")
        await _human_click(page, submit_btn)
        print(f"[ats-form] Clicked. URL immediately: {page.url}")
        await page.wait_for_timeout(5000)
        url_after = page.url
        print(f"[ats-form] URL after 5s: {url_after}")

        screenshot_path = f"/tmp/ats_debug_{int(time.time())}.png"
        await page.screenshot(path=screenshot_path, full_page=True)
        print(f"[ats-form] Screenshot: {screenshot_path}")

        page_text = await page.inner_text("body")
        print(f"[ats-form] Page text (first 500):\n{page_text[:500]}")
        page_text_lower = page_text.lower()

        # Greenhouse email verification challenge — appears instead of success page
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

        # Explicit success signals — Greenhouse thank-you page or in-place message
        success_signals = [
            "thank you", "application received", "successfully submitted",
            "we'll be in touch", "application has been submitted",
            "your application has been", "תודה",
        ]
        if any(s in page_text_lower for s in success_signals):
            print("[ats-form] SUCCESS confirmed via page text")
            return {"success": True, "filled": filled, "message": "Application submitted successfully"}

        # Real field-level errors only — exclude form legend ("* indicates a required field")
        # which is always present on the page regardless of validation state.
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

        # URL changed → likely navigated to a success/redirect page
        if url_after != url_before:
            print(f"[ats-form] URL changed after submit: {url_before} → {url_after}")
            return {"success": True, "filled": filled, "message": "Application submitted (URL changed)"}

        # No explicit success, no real errors, same URL — treat as submitted
        print("[ats-form] No success/error signals — assuming submitted")
        return {"success": True, "filled": filled, "message": "Form submitted (no explicit confirmation)"}

    except Exception as e:
        return {"success": False, "error": f"Submit failed: {str(e)}", "filled": filled, "errors": errors}
