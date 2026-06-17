import asyncio
import base64
import os
import sys
import tempfile
import traceback
import threading

import asyncpg
from fastapi import APIRouter
from pydantic import BaseModel

from routes.apply import _build_cv_pdf

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


def _run_ats_apply_sync(request_dict: dict) -> None:
    """Sync wrapper — runs in FastAPI's thread pool with its own event loop."""
    print("[ats-apply-bg] ===== THREAD STARTED =====")
    print(f"[ats-apply-bg] platform={request_dict['ats_platform']}")
    print(f"[ats-apply-bg] url={request_dict['apply_url']}")
    print(f"[ats-apply-bg] application_id={request_dict['application_id']}")
    print(f"[ats-apply-bg] cv_base64 length={len(request_dict['user_data'].get('cv_base64') or '')}")

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def _run() -> None:
            from routes.ats_submit import submit_via_ats

            print("[ats-apply-bg] Calling submit_via_ats...")
            result = await submit_via_ats(
                apply_url=request_dict["apply_url"],
                ats_platform=request_dict["ats_platform"],
                user_data=request_dict["user_data"],
            )
            print(f"[ats-apply-bg] submit_via_ats returned: {result}")

            if result.get("success"):
                status = "applied"
            else:
                status = "failed"
                reason = "captcha" if (result.get("captcha") or result.get("recaptcha")) else result.get("error", "unknown")
                print(f"[ats-apply-bg] form fill failed: {reason}")

            print(f"[ats-apply-bg] Updating DB: {request_dict['application_id']} -> {status}")
            conn = await asyncpg.connect(os.environ["DATABASE_URL"])
            try:
                error_msg = result.get("error") if status == "failed" else None
                await conn.execute(
                    'UPDATE "Application" SET status = $1, applied_at = NOW(), error_message = $2 WHERE id = $3',
                    status,
                    error_msg,
                    request_dict["application_id"],
                )
                print(f"[ats-apply-bg] DB updated: {request_dict['application_id']} -> {status}")
            finally:
                await conn.close()

        loop.run_until_complete(_run())
        loop.close()

    except Exception as e:
        print(f"[ats-apply-bg] EXCEPTION: {type(e).__name__}: {e}")
        traceback.print_exc(file=sys.stdout)

    print("[ats-apply-bg] ===== THREAD ENDED =====")


@router.post("/ats-apply")
async def ats_apply(req: ATSApplyRequest):
    """Kick off ATS form fill in background and return immediately."""
    print(f"[ats-apply] {req.ats_platform} — {req.apply_url[:80]}")

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        row = await conn.fetchrow(
            'SELECT tailored_cv, cover_letter FROM "Application" WHERE id = $1 AND user_id = $2',
            req.application_id,
            req.user_id,
        )

        if not row:
            return {"success": False, "error": "Application not found"}

        tailored_cv = row["tailored_cv"] or ""
        cover_letter = row["cover_letter"] or ""

        if not tailored_cv:
            # Quick-apply path: no tailored CV yet — fall back to the user's raw uploaded CV
            cv_row = await conn.fetchrow(
                'SELECT raw_text FROM "CV" WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
                req.user_id,
            )
            if not cv_row or not cv_row["raw_text"]:
                return {"success": False, "error": "No CV uploaded — please upload your CV in Settings first"}
            tailored_cv = cv_row["raw_text"]
            print(f"[ats-apply] Quick-apply: using raw CV ({len(tailored_cv)} chars)")
    finally:
        await conn.close()

    pdf_path = os.path.join(tempfile.gettempdir(), f"ats_{req.application_id}.pdf")
    try:
        _build_cv_pdf(tailored_cv, pdf_path)
    except Exception as exc:
        return {"success": False, "error": f"PDF generation failed: {exc}"}

    with open(pdf_path, "rb") as f:
        cv_bytes = f.read()
    cv_base64 = base64.b64encode(cv_bytes).decode("ascii")
    print(f"[ats-apply] PDF size={len(cv_bytes)} bytes, base64 length={len(cv_base64)}")

    name_part = f"{req.first_name}_{req.last_name}".strip("_").replace(" ", "_") or "applicant"
    cv_filename = f"{name_part}_cv.pdf"

    request_dict = {
        "apply_url": req.apply_url,
        "ats_platform": req.ats_platform,
        "application_id": req.application_id,
        "user_data": {
            "first_name": req.first_name,
            "last_name": req.last_name,
            "email": req.email,
            "phone": req.phone,
            "linkedin_url": req.linkedin_url,
            "cv_base64": cv_base64,
            "cv_filename": cv_filename,
            "cover_letter": cover_letter,
        },
    }

    thread = threading.Thread(
        target=_run_ats_apply_sync,
        args=(request_dict,),
        daemon=True,
    )
    thread.start()
    print(f"[ats-apply] Thread started: {thread.ident}")
    return {"success": True, "status": "applying"}
