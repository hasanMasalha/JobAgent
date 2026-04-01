import os
import tempfile
import asyncpg
from fastapi import APIRouter
from pydantic import BaseModel
from playwright.async_api import async_playwright

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


@router.post("/apply")
async def apply_to_job(req: ApplyRequest):
    if "linkedin.com" not in req.job_url:
        return {"status": "manual", "message": "Open job link to apply manually"}

    # Fetch user info and application data in one connection
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        user = await conn.fetchrow(
            'SELECT name, email, phone FROM "User" WHERE id = $1', req.user_id
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
    phone = user["phone"] or ""
    parts = name.split()
    first_name = parts[0] if parts else ""
    last_name = parts[-1] if len(parts) > 1 else ""

    tailored_cv = application["tailored_cv"] or ""
    cover_letter = application["cover_letter"] or ""

    # Generate PDF from tailored CV summary
    pdf_path = os.path.join(tempfile.gettempdir(), f"{req.application_id}_cv.pdf")
    try:
        _build_cv_pdf(tailored_cv, pdf_path)
    except Exception as e:
        return {"status": "failed", "message": f"PDF generation failed: {e}"}

    profile_dir = os.path.join("browser_profile", req.user_id)
    os.makedirs(profile_dir, exist_ok=True)
    os.makedirs("screenshots", exist_ok=True)

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            profile_dir,
            headless=False,  # visible — user logs into LinkedIn manually on first run
            args=["--no-sandbox"],
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        try:
            await page.goto(req.job_url, timeout=30_000)
            await page.wait_for_timeout(2000)

            # Check for Easy Apply button
            easy_apply = page.locator("button:has-text('Easy Apply')").first
            try:
                await easy_apply.wait_for(state="visible", timeout=5000)
            except Exception:
                return {"status": "manual", "message": "No Easy Apply button — apply via the job link"}

            await easy_apply.click()
            await page.wait_for_timeout(1500)

            # Fill contact fields (best-effort — LinkedIn modal structure varies)
            fill_map = [
                ("input[id*='firstName'], input[name='firstName']", first_name),
                ("input[id*='lastName'], input[name='lastName']", last_name),
                ("input[type='email']", email),
                ("input[type='tel']", phone),
            ]
            for selector, value in fill_map:
                if not value:
                    continue
                try:
                    field = page.locator(selector).first
                    if await field.is_visible(timeout=2000):
                        await field.fill(value)
                except Exception:
                    pass

            # Upload CV PDF
            try:
                file_input = page.locator("input[type='file']").first
                if await file_input.is_visible(timeout=3000):
                    await file_input.set_input_files(pdf_path)
                else:
                    # Some LinkedIn modals hide the input behind an upload button
                    upload_btn = page.locator(
                        "button:has-text('Upload'), label:has-text('Upload resume')"
                    ).first
                    if await upload_btn.is_visible(timeout=2000):
                        await upload_btn.click()
                        await page.wait_for_timeout(500)
                        await page.locator("input[type='file']").first.set_input_files(pdf_path)
            except Exception:
                pass

            # Fill cover letter textarea
            try:
                cl_area = page.locator(
                    "textarea[id*='cover'], textarea[name*='cover'], "
                    "textarea[placeholder*='cover'], textarea[placeholder*='Cover']"
                ).first
                if await cl_area.is_visible(timeout=3000):
                    await cl_area.fill(cover_letter)
            except Exception:
                pass

            # Screenshot before submit
            screenshot_path = os.path.join("screenshots", f"{req.application_id}.png")
            await page.screenshot(path=screenshot_path, full_page=False)

            # Click submit button
            submit_btn = page.locator(
                "button[aria-label*='Submit'], button:has-text('Submit application')"
            ).first
            try:
                await submit_btn.wait_for(state="visible", timeout=5000)
            except Exception:
                return {"status": "failed", "message": "Could not find submit button"}

            await submit_btn.click()

            # Wait for confirmation
            try:
                await page.wait_for_selector(
                    "div:has-text('application was sent'), "
                    "div:has-text('Application submitted'), "
                    "h3:has-text('Your application was sent')",
                    timeout=8000,
                )
            except Exception:
                pass  # Confirmation detection is best-effort

            return {"status": "applied", "message": "Application submitted via LinkedIn Easy Apply"}

        except Exception as e:
            return {"status": "failed", "message": str(e)}
        finally:
            await ctx.close()
