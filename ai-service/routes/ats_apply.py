import base64
import os
import sys
import tempfile
import traceback

import asyncpg
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from routes.apply import _build_cv_pdf
from routes.ats_submit import submit_via_ats

router = APIRouter()


class ATSApplyRequest(BaseModel):
    job_id: str
    apply_url: str
    ats_platform: str
    application_id: str
    user_id: str
    first_name: str
    last_name: str
    email: str
    phone: str = ""
    linkedin_url: str = ""


@router.post("/ats-apply")
async def ats_apply(req: ATSApplyRequest, background_tasks: BackgroundTasks):
    """Kick off ATS form fill in background and return immediately."""
    print(f"[ats-apply] {req.ats_platform} — {req.apply_url[:80]}")

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        row = await conn.fetchrow(
            'SELECT tailored_cv, cover_letter FROM "Application" WHERE id = $1 AND user_id = $2',
            req.application_id,
            req.user_id,
        )
    finally:
        await conn.close()

    if not row:
        return {"success": False, "error": "Application not found"}

    tailored_cv = row["tailored_cv"] or ""
    cover_letter = row["cover_letter"] or ""

    if not tailored_cv:
        return {"success": False, "error": "No tailored CV found — run /api/apply/prepare first"}

    # Generate PDF from tailored CV text
    pdf_path = os.path.join(tempfile.gettempdir(), f"ats_{req.application_id}.pdf")
    try:
        _build_cv_pdf(tailored_cv, pdf_path)
    except Exception as exc:
        return {"success": False, "error": f"PDF generation failed: {exc}"}

    with open(pdf_path, "rb") as f:
        cv_bytes = f.read()
    cv_base64 = base64.b64encode(cv_bytes).decode("ascii")

    name_part = f"{req.first_name}_{req.last_name}".strip("_").replace(" ", "_") or "applicant"
    cv_filename = f"{name_part}_cv.pdf"

    user_data = {
        "first_name": req.first_name,
        "last_name": req.last_name,
        "email": req.email,
        "phone": req.phone,
        "linkedin_url": req.linkedin_url,
        "cv_base64": cv_base64,
        "cv_filename": cv_filename,
        "cover_letter": cover_letter,
    }

    print(f"[ats-apply] Scheduling background task for {req.application_id}")
    background_tasks.add_task(_do_ats_apply, req, user_data)
    print(f"[ats-apply] Background task scheduled — returning 'applying'")
    return {"success": True, "status": "applying"}


async def _do_ats_apply(req: ATSApplyRequest, user_data: dict) -> None:
    """Run Playwright form fill in background and update DB when done."""
    print(f"[ats-apply-bg] ===== BACKGROUND TASK STARTED =====")
    print(f"[ats-apply-bg] platform={req.ats_platform}")
    print(f"[ats-apply-bg] url={req.apply_url}")
    print(f"[ats-apply-bg] application_id={req.application_id}")
    print(f"[ats-apply-bg] first_name={req.first_name}")
    print(f"[ats-apply-bg] cv_base64 length={len(user_data.get('cv_base64') or '')}")

    try:
        print("[ats-apply-bg] Calling submit_via_ats...")
        result = await submit_via_ats(
            apply_url=req.apply_url,
            ats_platform=req.ats_platform,
            user_data=user_data,
        )
        print(f"[ats-apply-bg] submit_via_ats returned: {result}")

        if result.get("recaptcha"):
            status = "manual"
        elif result.get("success"):
            status = "applied"
        else:
            status = "failed"
            print(f"[ats-apply-bg] form fill failed: {result.get('error')}")

        print(f"[ats-apply-bg] Updating DB: {req.application_id} -> {status}")
        conn = await asyncpg.connect(os.environ["DATABASE_URL"])
        try:
            await conn.execute(
                'UPDATE "Application" SET status = $1, applied_at = NOW() WHERE id = $2',
                status,
                req.application_id,
            )
            print(f"[ats-apply-bg] DB updated: {req.application_id} -> {status}")
        finally:
            await conn.close()

    except Exception as e:
        print(f"[ats-apply-bg] EXCEPTION: {type(e).__name__}: {e}")
        print(f"[ats-apply-bg] TRACEBACK:")
        traceback.print_exc(file=sys.stdout)

    print(f"[ats-apply-bg] ===== BACKGROUND TASK ENDED =====")
