import os
import asyncpg
from fastapi import APIRouter
from pydantic import BaseModel
from playwright.async_api import async_playwright

router = APIRouter()


class ApplyRequest(BaseModel):
    job_url: str
    application_id: str
    user_id: str


@router.post("/apply")
async def apply_to_job(req: ApplyRequest):
    if "linkedin.com" not in req.job_url:
        return {"status": "manual", "message": "Open job link to apply manually"}

    # Fetch user name and email from DB
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        user = await conn.fetchrow(
            'SELECT name, email FROM "User" WHERE id = $1', req.user_id
        )
    finally:
        await conn.close()

    if not user:
        return {"status": "failed", "message": "User not found"}

    name = user["name"] or ""
    email = user["email"] or ""
    parts = name.split()
    first_name = parts[0] if parts else ""
    last_name = parts[-1] if len(parts) > 1 else ""

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

            # Look for Easy Apply button
            easy_apply = page.locator("button:has-text('Easy Apply')").first
            try:
                await easy_apply.wait_for(state="visible", timeout=5000)
            except Exception:
                return {"status": "manual", "message": "No Easy Apply button — apply via the job link"}

            await easy_apply.click()
            await page.wait_for_timeout(1500)

            # Fill fields best-effort (LinkedIn modal structure varies)
            fill_map = [
                ("input[id*='firstName'], input[name='firstName']", first_name),
                ("input[id*='lastName'], input[name='lastName']", last_name),
                ("input[type='email']", email),
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

            # Screenshot before submit
            screenshot_path = os.path.join("screenshots", f"{req.application_id}.png")
            await page.screenshot(path=screenshot_path, full_page=False)

            # Find and click submit button
            submit_btn = page.locator(
                "button[aria-label*='Submit'], button:has-text('Submit application')"
            ).first
            try:
                await submit_btn.wait_for(state="visible", timeout=5000)
            except Exception:
                return {"status": "failed", "message": "Could not find submit button in Easy Apply modal"}

            await submit_btn.click()
            await page.wait_for_timeout(2000)
            return {"status": "applied", "message": "Application submitted via LinkedIn Easy Apply"}

        except Exception as e:
            return {"status": "failed", "message": str(e)}
        finally:
            await ctx.close()
