import asyncio
import base64
import os
import sys
import tempfile
import traceback
import threading

import asyncpg
import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from routes.apply import _build_cv_pdf

# Python fully-buffers stdout by default when it isn't attached to a TTY
# (true under uvicorn/Docker) — a slow background thread's print()s can sit
# in that buffer indefinitely, looking exactly like a silent hang even
# though the thread is running fine. Line-buffer process-wide so every
# print (in this module and everything it calls) actually reaches the logs
# as it happens.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

router = APIRouter()

NEXTJS_URL = os.environ.get("NEXTJS_URL", "http://localhost:3000")
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")


async def _send_application_confirmation_email(application_id: str) -> None:
    print("[ats-apply] Sending confirmation email to user")
    print(f"[ats-apply] NEXTJS_URL={NEXTJS_URL!r} INTERNAL_API_KEY_set={bool(INTERNAL_API_KEY)}")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{NEXTJS_URL}/api/email/send-application-confirmation",
                json={"application_id": application_id},
                headers={"X-Internal-Key": INTERNAL_API_KEY},
                timeout=30,
            )
            result = {"status_code": resp.status_code, "body": resp.text[:200]}
            print(f"[ats-apply] Email result: {result}")
    except Exception:
        print("[ats-apply] Email result: request failed (non-fatal)")
        traceback.print_exc(file=sys.stdout)


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

            print("[ats-apply-bg] Step 1: calling submit_via_ats")
            try:
                # asyncio.wait_for (not a second thread + asyncio.run) — we're
                # already inside this thread's own event loop via
                # run_until_complete below, so there's no "already running
                # loop" conflict to work around. wait_for cancels the inner
                # coroutine on timeout; that cancellation is a BaseException
                # (CancelledError), so it passes straight through
                # submit_via_ats's own `except Exception` instead of being
                # swallowed there.
                result = await asyncio.wait_for(
                    submit_via_ats(
                        apply_url=request_dict["apply_url"],
                        ats_platform=request_dict["ats_platform"],
                        user_data=request_dict["user_data"],
                    ),
                    timeout=120,
                )
            except asyncio.TimeoutError:
                print("[ats-apply-bg] TIMEOUT after 120s — submit_via_ats did not complete")
                result = {
                    "success": False,
                    "error": "timeout",
                    "message": "Apply timed out after 2 minutes",
                }
            print(f"[ats-apply-bg] Step 2: got result: {result}")

            print("[ats-apply-bg] Step 3: determining status")
            if result.get("success") and result.get("status") == "pending_verification":
                status = "pending_verification"
                print("[ats-apply-bg] Greenhouse email verification required")
            elif result.get("success"):
                status = "applied"
            elif result.get("error") == "unknown_state":
                # We couldn't find a confirmation signal, but we also have no
                # positive evidence the submit failed (no field errors, no
                # captcha, no exception) — don't tell the user it failed when
                # it may well have gone through. Only actual errors map to
                # 'failed' below.
                status = "pending_verification"
                print("[ats-apply-bg] Could not confirm outcome — treating as pending_verification, not failed")
            else:
                status = "failed"
                reason = "captcha" if (result.get("captcha") or result.get("recaptcha")) else result.get("error", "unknown")
                print(f"[ats-apply-bg] form fill failed: {reason}")
            print(f"[ats-apply-bg] Step 4: status determined: {status}")

            print(f"[ats-apply-bg] Step 5: updating DB -> {status}")
            conn = await asyncpg.connect(os.environ["DATABASE_URL"])
            try:
                if status == "failed":
                    error_msg = result.get("message") or result.get("error")
                elif status == "pending_verification":
                    # result["message"] already distinguishes "Greenhouse emailed you a
                    # verification code" from "submitted but unconfirmed" — use it
                    # instead of a single hardcoded message that only fit the former.
                    error_msg = result.get("message") or (
                        "Check your email for a verification code from Greenhouse to complete your application."
                    )
                else:
                    error_msg = None
                await conn.execute(
                    'UPDATE "Application" SET status = $1, applied_at = NOW(), error_message = $2 WHERE id = $3',
                    status,
                    error_msg,
                    request_dict["application_id"],
                )
                print(f"[ats-apply-bg] Step 6: DB updated: {request_dict['application_id']} -> {status}")
            finally:
                await conn.close()

            if status in ("applied", "pending_verification"):
                print("[ats-apply-bg] Step 7: sending confirmation email")
                await _send_application_confirmation_email(request_dict["application_id"])
                print("[ats-apply-bg] Step 8: confirmation email step complete")

        loop.run_until_complete(_run())
        loop.close()

    except Exception as e:
        print(f"[ats-apply-bg] UNHANDLED EXCEPTION: {type(e).__name__}: {e}")
        print(f"[ats-apply-bg] TRACEBACK: {traceback.format_exc()}")
        # Capture as a plain string — `e` is implicitly unbound once this
        # except block exits, so the closure below can't reference it directly.
        error_text = f"Unexpected error: {e}"

        # Without this, a crash here leaves the Application stuck at
        # 'applying' forever — no status update, no way for the user to
        # know anything went wrong. Use a fresh event loop: the one above
        # may be in an inconsistent state after the exception.
        async def _mark_failed() -> None:
            conn = await asyncpg.connect(os.environ["DATABASE_URL"])
            try:
                await conn.execute(
                    'UPDATE "Application" SET status = $1, applied_at = NOW(), error_message = $2 WHERE id = $3',
                    "failed",
                    error_text,
                    request_dict["application_id"],
                )
                print(f"[ats-apply-bg] DB updated after exception: {request_dict['application_id']} -> failed")
            finally:
                await conn.close()

        try:
            fail_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(fail_loop)
            fail_loop.run_until_complete(_mark_failed())
            fail_loop.close()
        except Exception:
            print("[ats-apply-bg] Failed to update DB after exception (non-fatal)")
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

        # Structured "Easy Apply defaults" — used to answer common custom
        # questions (sponsorship, work authorization, salary, etc.) without
        # guessing or calling Claude for things we already know.
        profile_row = await conn.fetchrow(
            'SELECT years_of_experience, expected_salary, work_authorized, requires_sponsorship, '
            'willing_to_relocate, notice_period, portfolio_url, github_url, highest_education, '
            'city, "currentCompany" '
            'FROM "User" WHERE id = $1',
            req.user_id,
        )
        profile = dict(profile_row) if profile_row else {}
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
            "profile": profile,
            "cv_text": tailored_cv,
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
