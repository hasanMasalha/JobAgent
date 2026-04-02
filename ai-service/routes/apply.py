import os
import tempfile
import asyncpg
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from playwright.async_api import async_playwright, Page
from utils.cv_pdf import generate_cv_pdf

router = APIRouter()


class ApplyRequest(BaseModel):
    job_url: str
    application_id: str
    user_id: str


def _build_cv_pdf(tailored_cv: str, output_path: str) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    doc = SimpleDocTemplate(output_path, pagesize=A4)
    styles = getSampleStyleSheet()
    story = []
    for line in tailored_cv.split("\n"):
        if line.strip():
            story.append(Paragraph(line.strip(), styles["Normal"]))
            story.append(Spacer(1, 6))
    doc.build(story)


# ── shared helpers ────────────────────────────────────────────────────────────

async def _try_fill(page: Page, selector: str, value: str) -> bool:
    """Fill a field if visible. Returns True on success."""
    if not value:
        return False
    try:
        el = page.locator(selector).first
        if await el.is_visible(timeout=1500):
            await el.fill(value)
            return True
    except Exception:
        pass
    return False


async def _try_click(page: Page, selector: str, timeout: int = 3000) -> bool:
    try:
        el = page.locator(selector).first
        await el.wait_for(state="visible", timeout=timeout)
        await el.click()
        return True
    except Exception:
        return False


# ── Indeed apply ──────────────────────────────────────────────────────────────

async def _apply_indeed(
    page: Page,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    pdf_path: str,
    cover_letter: str,
    screenshot_path: str,
) -> dict:

    await page.wait_for_load_state("domcontentloaded", timeout=15000)
    await page.wait_for_timeout(1500)

    # Click the apply button (Hebrew and English variants)
    apply_selectors = [
        "button:has-text('Apply now')",
        "button:has-text('Indeed Apply')",
        "a:has-text('Apply now')",
        "button:has-text('הגש מועמדות')",
        "a:has-text('הגש מועמדות')",
        "[data-testid='apply-button']",
        "[class*='ApplyButton']",
    ]
    clicked = False
    for sel in apply_selectors:
        if await _try_click(page, sel, timeout=3000):
            clicked = True
            break

    if not clicked:
        return {"status": "manual", "message": "Could not find Apply button on Indeed page"}

    await page.wait_for_timeout(2500)

    # If a new tab opened, switch to it
    if len(page.context.pages) > 1:
        page = page.context.pages[-1]
        await page.wait_for_load_state("domcontentloaded", timeout=15000)
        await page.wait_for_timeout(1500)

    # If redirected off indeed.com → external company site
    current_url = page.url
    if "indeed.com" not in current_url and "indeedapply.com" not in current_url:
        return {
            "status": "manual",
            "message": f"Job redirects to external site — apply manually: {current_url}",
        }

    # Multi-step form loop (up to 10 steps)
    for step in range(10):
        await page.wait_for_timeout(1000)
        current_url = page.url

        # If navigated away from Indeed mid-flow
        if "indeed.com" not in current_url and "indeedapply.com" not in current_url:
            return {"status": "manual", "message": "Redirected to external site during apply"}

        # Fill contact / personal info fields
        await _try_fill(page, "input[name='firstName'], input[id*='firstName']", first_name)
        await _try_fill(page, "input[name='lastName'], input[id*='lastName']", last_name)
        await _try_fill(page, "input[type='email'], input[name='email']", email)
        await _try_fill(page, "input[type='tel'], input[name='phone'], input[id*='phone']", phone)

        # Resume / CV upload
        try:
            file_input = page.locator("input[type='file']").first
            if await file_input.is_visible(timeout=1500):
                await file_input.set_input_files(pdf_path)
            else:
                upload_btn = page.locator(
                    "button:has-text('Upload'), button:has-text('Upload resume'), "
                    "label:has-text('Upload'), label:has-text('העלה')"
                ).first
                if await upload_btn.is_visible(timeout=1500):
                    await upload_btn.click()
                    await page.wait_for_timeout(800)
                    await page.locator("input[type='file']").first.set_input_files(pdf_path)
        except Exception:
            pass

        # Cover letter textarea
        try:
            cl = page.locator(
                "textarea[name*='cover'], textarea[id*='cover'], "
                "textarea[placeholder*='cover'], textarea[placeholder*='Cover'], "
                "textarea[placeholder*='מכתב']"
            ).first
            if await cl.is_visible(timeout=1500):
                await cl.fill(cover_letter)
        except Exception:
            pass

        # Handle screening questions — radio/checkbox: pick first option; required text: fill name
        try:
            radio_groups = await page.locator("fieldset").all()
            for fieldset in radio_groups[:5]:
                radios = await fieldset.locator("input[type='radio']").all()
                if radios:
                    try:
                        if not await radios[0].is_checked():
                            await radios[0].click()
                    except Exception:
                        pass

            required_texts = await page.locator(
                "input[required]:not([type='file']):not([type='radio']):not([type='checkbox'])"
            ).all()
            for inp in required_texts[:5]:
                try:
                    val = await inp.input_value()
                    if not val:
                        placeholder = await inp.get_attribute("placeholder") or ""
                        await inp.fill(first_name if "name" in placeholder.lower() else email)
                except Exception:
                    pass
        except Exception:
            pass

        # Detect submit button (check before continue)
        submit_sel = (
            "button[type='submit']:has-text('Submit'), "
            "button:has-text('Submit application'), "
            "button:has-text('Submit my application'), "
            "button:has-text('שלח מועמדות'), "
            "button[data-testid='submit-application']"
        )
        submit_btn = page.locator(submit_sel).first
        is_submit = False
        try:
            is_submit = await submit_btn.is_visible(timeout=1500)
        except Exception:
            pass

        if is_submit:
            await page.screenshot(path=screenshot_path, full_page=False)
            await submit_btn.click()
            await page.wait_for_timeout(3000)
            # Detect success confirmation
            success_sel = (
                "text=application was sent, text=Application submitted, "
                "text=applied successfully, text=Your application, "
                "text=הגשת מועמדות, text=נשלחה בהצלחה"
            )
            try:
                await page.wait_for_selector(success_sel, timeout=6000)
            except Exception:
                pass
            return {"status": "applied", "message": "Application submitted via Indeed Apply"}

        # Click Continue / Next to advance to next step
        continued = False
        for continue_sel in [
            "button:has-text('Continue')", "button:has-text('Next')",
            "button:has-text('המשך')", "button[type='submit']",
        ]:
            if await _try_click(page, continue_sel, timeout=2000):
                continued = True
                break

        if not continued:
            # No continue and no submit — stuck
            break

    # Timed out or stuck — take screenshot and return manual
    try:
        await page.screenshot(path=screenshot_path, full_page=False)
    except Exception:
        pass
    return {"status": "manual", "message": "Could not complete Indeed application — apply manually via the link"}


# ── LinkedIn apply ─────────────────────────────────────────────────────────────

async def _apply_linkedin(
    page: Page,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    pdf_path: str,
    cover_letter: str,
    screenshot_path: str,
) -> dict:
    await page.goto(page.url, timeout=30_000)
    await page.wait_for_timeout(2000)

    easy_apply = page.locator("button:has-text('Easy Apply')").first
    try:
        await easy_apply.wait_for(state="visible", timeout=5000)
    except Exception:
        return {"status": "manual", "message": "No Easy Apply button — apply via the job link"}

    await easy_apply.click()
    await page.wait_for_timeout(1500)

    fill_map = [
        ("input[id*='firstName'], input[name='firstName']", first_name),
        ("input[id*='lastName'], input[name='lastName']", last_name),
        ("input[type='email']", email),
        ("input[type='tel']", phone),
    ]
    for selector, value in fill_map:
        await _try_fill(page, selector, value)

    try:
        file_input = page.locator("input[type='file']").first
        if await file_input.is_visible(timeout=3000):
            await file_input.set_input_files(pdf_path)
        else:
            upload_btn = page.locator(
                "button:has-text('Upload'), label:has-text('Upload resume')"
            ).first
            if await upload_btn.is_visible(timeout=2000):
                await upload_btn.click()
                await page.wait_for_timeout(500)
                await page.locator("input[type='file']").first.set_input_files(pdf_path)
    except Exception:
        pass

    try:
        cl_area = page.locator(
            "textarea[id*='cover'], textarea[name*='cover'], "
            "textarea[placeholder*='cover'], textarea[placeholder*='Cover']"
        ).first
        if await cl_area.is_visible(timeout=3000):
            await cl_area.fill(cover_letter)
    except Exception:
        pass

    await page.screenshot(path=screenshot_path, full_page=False)

    submit_btn = page.locator(
        "button[aria-label*='Submit'], button:has-text('Submit application')"
    ).first
    try:
        await submit_btn.wait_for(state="visible", timeout=5000)
    except Exception:
        return {"status": "failed", "message": "Could not find submit button"}

    await submit_btn.click()

    try:
        await page.wait_for_selector(
            "div:has-text('application was sent'), "
            "div:has-text('Application submitted'), "
            "h3:has-text('Your application was sent')",
            timeout=8000,
        )
    except Exception:
        pass

    return {"status": "applied", "message": "Application submitted via LinkedIn Easy Apply"}


# ── main handler ───────────────────────────────────────────────────────────────

@router.post("/apply")
async def apply_to_job(req: ApplyRequest):
    is_linkedin = "linkedin.com" in req.job_url
    is_indeed = "indeed.com" in req.job_url

    if not is_linkedin and not is_indeed:
        return {"status": "manual", "message": "Open job link to apply manually"}

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        user = await conn.fetchrow(
            'SELECT name, email FROM "User" WHERE id = $1', req.user_id
        )
        application = await conn.fetchrow(
            'SELECT tailored_cv, cover_letter FROM "Application" WHERE id = $1 AND user_id = $2',
            req.application_id,
            req.user_id,
        )
    finally:
        await conn.close()

    if not user:
        return {"status": "failed", "message": "User not found"}
    if not application:
        return {"status": "failed", "message": "Application not found"}

    name = user["name"] or ""
    email = user["email"] or ""
    phone = ""
    parts = name.split()
    first_name = parts[0] if parts else ""
    last_name = parts[-1] if len(parts) > 1 else ""

    tailored_cv = application["tailored_cv"] or ""
    cover_letter = application["cover_letter"] or ""

    pdf_path = os.path.join(tempfile.gettempdir(), f"{req.application_id}_cv.pdf")
    try:
        _build_cv_pdf(tailored_cv, pdf_path)
    except Exception as e:
        return {"status": "failed", "message": f"PDF generation failed: {e}"}

    profile_dir = os.path.join("browser_profile", req.user_id)
    os.makedirs(profile_dir, exist_ok=True)
    os.makedirs("screenshots", exist_ok=True)
    screenshot_path = os.path.join("screenshots", f"{req.application_id}.png")

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            profile_dir,
            headless=False,
            args=["--no-sandbox"],
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        try:
            await page.goto(req.job_url, timeout=30_000)

            if is_indeed:
                result = await _apply_indeed(
                    page, first_name, last_name, email, phone,
                    pdf_path, cover_letter, screenshot_path,
                )
            else:
                result = await _apply_linkedin(
                    page, first_name, last_name, email, phone,
                    pdf_path, cover_letter, screenshot_path,
                )

            return result

        except Exception as e:
            return {"status": "failed", "message": str(e)}
        finally:
            await ctx.close()


# ── PDF download ───────────────────────────────────────────────────────────────

@router.get("/generate-cv-pdf")
async def generate_cv_pdf_endpoint(application_id: str):
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        row = await conn.fetchrow(
            """
            SELECT a.tailored_cv, j.title AS job_title
            FROM "Application" a
            JOIN "Job" j ON j.id = a.job_id
            WHERE a.id = $1
            LIMIT 1
            """,
            application_id,
        )
    finally:
        await conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    if not row["tailored_cv"]:
        raise HTTPException(status_code=404, detail="No tailored CV for this application")

    pdf_bytes = generate_cv_pdf(row["tailored_cv"])
    safe_title = (row["job_title"] or "tailored").replace(" ", "_")[:50]
    filename = f"CV_{safe_title}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
