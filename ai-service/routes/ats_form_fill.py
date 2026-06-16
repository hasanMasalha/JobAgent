import os
import tempfile
import time

from playwright.async_api import async_playwright


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
                    "--disable-blink-features=AutomationControlled",
                ],
            )

            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            )
            page = await context.new_page()

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

    # Submit
    try:
        submit = await page.wait_for_selector(
            'button[type="submit"], '
            'button:has-text("Submit application"), '
            'button:has-text("Apply"), '
            'button:has-text("Submit")',
            timeout=5000,
        )
        if submit:
            await submit.click()
            await page.wait_for_timeout(4000)

            page_text = await page.inner_text("body")
            print(f"[ats-form] Lever: page text after submit:\n{page_text[:2000]}")

            if any(s in page_text.lower() for s in [
                "thank you", "application received", "successfully", "we'll be in touch"
            ]):
                return {"success": True, "filled": filled, "ats": "lever"}

            return {
                "success": True,
                "filled": filled,
                "ats": "lever",
                "message": "Submitted (no explicit confirmation)",
            }
    except Exception as e:
        return {"success": False, "error": f"Lever submit failed: {e}", "filled": filled}

    return {"success": False, "error": "Lever submit button not found", "filled": filled}


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

    await fill_field([
        "#first_name",
        'input[id="first_name"]',
        'input[name="first_name"]',
        'input[placeholder*="First"]',
        'input[id="first-name"]',
        'input[id*="first_name"]',
    ], first_name, "first_name")

    await fill_field([
        "#last_name",
        'input[id="last_name"]',
        'input[name="last_name"]',
        'input[placeholder*="Last"]',
        'input[id="last-name"]',
        'input[id*="last_name"]',
    ], last_name, "last_name")

    await fill_field([
        "#email",
        'input[id="email"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[id*="email"]',
    ], email, "email")

    # Greenhouse uses a country-code dropdown + bare number input
    try:
        country_select = await page.query_selector('select[name="phone_country_code"]')
        if country_select:
            await country_select.select_option(value="IL")
            print("[ats-form] Set phone country code to IL")
    except Exception:
        pass

    bare_phone = phone.replace("+972", "").replace("972", "").strip().lstrip("0")
    await fill_field([
        'input[name="phone"]',
        'input[id="phone"]',
        'input[type="tel"]',
        'input[id*="phone"]',
    ], bare_phone or phone, "phone")

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
            try:
                await q.fill("Yes")
                filled.append(f"custom_{q_id}")
                print(f"[ats-form] Filled custom question {q_id}")
            except Exception as e:
                print(f"[ats-form] Could not fill custom question {q_id}: {e}")

    # ── reCAPTCHA check — bail before submit if present ──────────────────────

    recaptcha = await page.query_selector(
        'iframe[src*="recaptcha"], .g-recaptcha, input[name="g-recaptcha-response"]'
    )
    if recaptcha:
        print("[ats-form] reCAPTCHA detected — cannot auto-submit")
        return {
            "success": False,
            "error": "recaptcha_detected",
            "recaptcha": True,
            "filled": filled,
            "message": "Form has reCAPTCHA — requires manual submission",
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

    # ── Submit ────────────────────────────────────────────────────────────────

    try:
        submit = await page.wait_for_selector(
            'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Apply")',
            timeout=5000,
        )
        if submit:
            await submit.click()
            await page.wait_for_timeout(3000)

            screenshot_path = f"/tmp/ats_debug_{int(time.time())}.png"
            await page.screenshot(path=screenshot_path, full_page=True)
            print(f"[ats-form] Screenshot saved: {screenshot_path}")

            page_text = await page.inner_text("body")
            print(f"[ats-form] Page text after submit:\n{page_text[:3000]}")

            error_els = await page.query_selector_all(
                '.error, .alert, [class*="error"], [class*="invalid"], [class*="required"]'
            )
            for el in error_els:
                try:
                    text = await el.inner_text()
                    if text.strip():
                        print(f"[ats-form] Error element: {text.strip()}")
                except Exception:
                    pass

            page_text_lower = page_text.lower()
            success_signals = [
                "thank you",
                "application received",
                "successfully submitted",
                "we'll be in touch",
                "application has been submitted",
                "תודה",
            ]
            if any(s in page_text_lower for s in success_signals):
                return {"success": True, "filled": filled, "message": "Application submitted successfully"}

            error_signals = ["error", "required", "invalid"]
            if any(s in page_text_lower for s in error_signals):
                return {
                    "success": False,
                    "error": "Form validation error after submit",
                    "filled": filled,
                    "errors": errors,
                }

            return {"success": True, "filled": filled, "message": "Form submitted (no explicit confirmation)"}

    except Exception as e:
        return {"success": False, "error": f"Could not submit form: {str(e)}", "filled": filled, "errors": errors}

    return {"success": False, "error": "Submit button not found", "filled": filled}
