import asyncio
import os
import tempfile

import anthropic
import asyncpg
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from playwright.async_api import ElementHandle, Page, async_playwright
from pydantic import BaseModel

from utils.cv_pdf import generate_cv_pdf

_anthropic = anthropic.Anthropic()

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
    for _step in range(10):
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


# ── LinkedIn Easy Apply — field helpers ───────────────────────────────────────

async def _get_field_label(page: Page, el: ElementHandle) -> str:
    """Return the best human-readable label for an input element."""
    # 1. aria-label attribute
    try:
        aria = await el.get_attribute("aria-label") or ""
        if aria.strip():
            return aria.strip()
    except Exception:
        pass

    # 2. aria-labelledby → look up the referenced element's text
    try:
        labelledby = await el.get_attribute("aria-labelledby") or ""
        if labelledby:
            ref = page.locator(f"#{labelledby.split()[0]}").first
            text = (await ref.inner_text()).strip()
            if text:
                return text
    except Exception:
        pass

    # 3. Associated <label for="...">
    try:
        el_id = await el.get_attribute("id") or ""
        if el_id:
            label = page.locator(f"label[for='{el_id}']").first
            text = (await label.inner_text()).strip()
            if text:
                return text
    except Exception:
        pass

    # 4. Nearest ancestor <label>
    try:
        text = await el.evaluate(
            """el => {
                let node = el.parentElement;
                while (node) {
                    if (node.tagName === 'LABEL') return node.innerText.trim();
                    node = node.parentElement;
                }
                return '';
            }"""
        )
        if text:
            return text
    except Exception:
        pass

    # 5. placeholder fallback
    try:
        return (await el.get_attribute("placeholder") or "").strip()
    except Exception:
        return ""


async def _ask_claude_for_answer(label: str, user: dict) -> str:
    """Use Claude Haiku to answer a screening question from LinkedIn."""
    profile = (
        f"Name: {user.get('first_name', '')} {user.get('last_name', '')}, "
        f"Email: {user.get('email', '')}"
    )
    prompt = (
        f"LinkedIn job application form field: \"{label}\"\n"
        f"Applicant profile: {profile}\n\n"
        "Reply with ONLY the answer value to fill in the field — nothing else.\n"
        "Rules:\n"
        "- For 'years of experience' questions: reply with a reasonable number (e.g. 3)\n"
        "- For work authorization / 'are you authorized to work': reply Yes\n"
        "- For sponsorship / 'do you require sponsorship': reply No\n"
        "- For salary expectation: reply with a blank string\n"
        "- For yes/no questions: reply Yes or No\n"
        "- If unsure, reply with an empty string"
    )
    try:
        msg = _anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=50,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text.strip()
    except Exception:
        return ""


async def _get_answer_for_field(label: str, user: dict) -> str:
    """Map common LinkedIn field labels to user data, Claude for the rest."""
    label_lower = label.lower()

    # Direct mappings — no Claude needed
    if "first name" in label_lower:
        return user.get("first_name", "")
    if "last name" in label_lower:
        return user.get("last_name", "")
    if "email" in label_lower:
        return user.get("email", "")
    if "phone" in label_lower or "mobile" in label_lower:
        return user.get("phone", "")
    if "city" in label_lower or "location" in label_lower:
        return user.get("city", "")
    if "linkedin" in label_lower and "url" in label_lower:
        return user.get("linkedin_url", "")
    if "website" in label_lower or "portfolio" in label_lower:
        return user.get("portfolio_url", "")

    # Questions that benefit from a reasoned answer
    if any(w in label_lower for w in [
        "year", "experience", "authorized", "authoris", "require",
        "sponsor", "salary", "expect", "notice", "reloc",
    ]):
        return await _ask_claude_for_answer(label, user)

    return ""


# ── LinkedIn Easy Apply — multi-step modal loop ───────────────────────────────

async def _handle_easy_apply_modal(
    page: Page,
    user: dict,
    pdf_path: str,
    cover_letter: str,
    screenshot_path: str,
) -> dict:
    max_steps = 10

    for step in range(max_steps):
        await page.wait_for_timeout(1000)

        # ── 1. Submit button → final step ────────────────────────────────────
        submit = page.locator(
            "button[aria-label*='Submit'], "
            "button:has-text('Submit application'), "
            "button:has-text('Review your application')"
        )
        if await submit.count() > 0:
            # Take screenshot before submitting
            try:
                await page.screenshot(path=screenshot_path, full_page=False)
            except Exception:
                pass
            await submit.last.click()
            await page.wait_for_timeout(2000)
            return {"status": "applied", "message": "Application submitted via LinkedIn Easy Apply"}

        # ── 2. CV / Resume upload ─────────────────────────────────────────────
        try:
            file_input = page.locator("input[type='file']").first
            if await file_input.is_visible(timeout=1000):
                await file_input.set_input_files(pdf_path)
            else:
                upload_btn = page.locator(
                    "button:has-text('Upload resume'), "
                    "label:has-text('Upload resume'), "
                    "button:has-text('Upload')"
                ).first
                if await upload_btn.is_visible(timeout=800):
                    await upload_btn.click()
                    await page.wait_for_timeout(600)
                    await page.locator("input[type='file']").first.set_input_files(pdf_path)
        except Exception:
            pass

        # ── 3. Cover letter textarea ──────────────────────────────────────────
        try:
            cl = page.locator(
                "textarea[id*='cover'], textarea[name*='cover'], "
                "textarea[placeholder*='cover'], textarea[placeholder*='Cover'], "
                "textarea[placeholder*='Write a cover']"
            ).first
            if await cl.is_visible(timeout=800):
                current = await cl.input_value()
                if not current:
                    await cl.fill(cover_letter)
        except Exception:
            pass

        # ── 4. Text / tel inputs that are empty ───────────────────────────────
        try:
            inputs: list[ElementHandle] = await page.query_selector_all(
                "input[type='text'], input[type='tel'], input[type='number'], textarea"
            )
            for inp in inputs[:10]:
                try:
                    current_val = await inp.input_value()
                    if current_val:
                        continue
                    label = await _get_field_label(page, inp)
                    if not label:
                        continue
                    value = await _get_answer_for_field(label, user)
                    if value:
                        await inp.fill(value)
                        await asyncio.sleep(0.3)
                except Exception:
                    pass
        except Exception:
            pass

        # ── 5. Dropdowns — pick first non-placeholder option ──────────────────
        try:
            selects: list[ElementHandle] = await page.query_selector_all("select")
            for sel in selects[:5]:
                try:
                    options: list[ElementHandle] = await sel.query_selector_all("option")
                    if len(options) > 1:
                        current = await sel.input_value()
                        if not current or current == options[0].get_attribute("value"):
                            await sel.select_option(index=1)
                except Exception:
                    pass
        except Exception:
            pass

        # ── 6. Radio buttons — prefer "Yes", else first option ────────────────
        try:
            fieldsets = await page.locator("fieldset").all()
            for fieldset in fieldsets[:8]:
                try:
                    radios = await fieldset.locator("input[type='radio']").all()
                    if not radios:
                        continue
                    already_checked = any(
                        await r.is_checked() for r in radios
                        if not isinstance(await r.is_checked(), Exception)
                    )
                    if already_checked:
                        continue
                    # Try to find a "Yes" option
                    yes_clicked = False
                    for radio in radios:
                        try:
                            label_el = page.locator(
                                f"label[for='{await radio.get_attribute('id') or ''}']"
                            ).first
                            text = (await label_el.inner_text()).strip().lower()
                            if text in ("yes", "כן"):
                                await radio.click()
                                yes_clicked = True
                                break
                        except Exception:
                            pass
                    if not yes_clicked:
                        await radios[0].click()
                except Exception:
                    pass
        except Exception:
            pass

        # ── 7. Checkboxes (e.g. privacy policy) ──────────────────────────────
        try:
            checkboxes = await page.locator(
                "input[type='checkbox']:not(:checked)"
            ).all()
            for cb in checkboxes[:3]:
                try:
                    await cb.click()
                except Exception:
                    pass
        except Exception:
            pass

        # ── 8. Click Next / Continue / Review ────────────────────────────────
        next_btn = page.locator(
            "button[aria-label*='Next'], "
            "button[aria-label*='Continue'], "
            "button[aria-label*='Review'], "
            "button:has-text('Next'), "
            "button:has-text('Continue')"
        ).last
        if await next_btn.count() > 0:
            await next_btn.click()
        else:
            return {
                "status": "failed",
                "message": f"Stuck on step {step + 1} — no Next or Submit button found",
            }

    return {"status": "failed", "message": "Exceeded maximum steps (10)"}


async def _apply_linkedin(
    page: Page,
    user: dict,
    pdf_path: str,
    cover_letter: str,
    screenshot_path: str,
) -> dict:
    await page.wait_for_timeout(2000)

    easy_apply = page.locator("button:has-text('Easy Apply')").first
    try:
        await easy_apply.wait_for(state="visible", timeout=5000)
    except Exception:
        return {"status": "manual", "message": "No Easy Apply button — apply via the job link"}

    await easy_apply.click()
    await page.wait_for_timeout(1500)

    return await _handle_easy_apply_modal(page, user, pdf_path, cover_letter, screenshot_path)


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
    parts = name.split()
    first_name = parts[0] if parts else ""
    last_name = parts[-1] if len(parts) > 1 else ""

    user_data = {
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "phone": "",
        "city": "",
        "linkedin_url": "",
        "portfolio_url": "",
    }

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
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
            ],
            ignore_default_args=["--enable-automation"],
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        try:
            await page.goto(req.job_url, timeout=30_000)

            if is_indeed:
                result = await _apply_indeed(
                    page, first_name, last_name, email, "",
                    pdf_path, cover_letter, screenshot_path,
                )
            else:
                result = await _apply_linkedin(
                    page, user_data, pdf_path, cover_letter, screenshot_path,
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
