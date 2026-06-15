import os
import tempfile

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

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False, prefix="cv_") as tmp:
        tmp.write(cv_bytes)
        cv_path = tmp.name

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

            print(f"[ats-form] Opening: {apply_url}")
            await page.goto(apply_url, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(2000)

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

    await fill_field([
        'input[name="first_name"]',
        'input[id*="first_name"]',
        'input[placeholder*="First"]',
        'input[id="first-name"]',
        "#first_name",
    ], first_name, "first_name")

    await fill_field([
        'input[name="last_name"]',
        'input[id*="last_name"]',
        'input[placeholder*="Last"]',
        'input[id="last-name"]',
        "#last_name",
    ], last_name, "last_name")

    await fill_field([
        'input[name="email"]',
        'input[type="email"]',
        'input[id*="email"]',
        "#email",
    ], email, "email")

    await fill_field([
        'input[name="phone"]',
        'input[type="tel"]',
        'input[id*="phone"]',
        "#phone",
    ], phone or "", "phone")

    await upload_file([
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

    try:
        submit = await page.wait_for_selector(
            'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Apply")',
            timeout=5000,
        )
        if submit:
            await submit.click()
            await page.wait_for_timeout(3000)

            page_text = (await page.inner_text("body")).lower()
            success_signals = [
                "thank you",
                "application received",
                "successfully submitted",
                "we'll be in touch",
                "application has been submitted",
                "תודה",
            ]
            if any(s in page_text for s in success_signals):
                return {"success": True, "filled": filled, "message": "Application submitted successfully"}

            error_signals = ["error", "required", "invalid"]
            if any(s in page_text for s in error_signals):
                return {"success": False, "error": "Form validation error after submit", "filled": filled}

            return {"success": True, "filled": filled, "message": "Form submitted (no explicit confirmation)"}

    except Exception as e:
        return {"success": False, "error": f"Could not submit form: {str(e)}", "filled": filled, "errors": errors}

    return {"success": False, "error": "Submit button not found", "filled": filled}
