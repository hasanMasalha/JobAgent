import asyncio
import base64
import os
import sys
import traceback
import threading

import asyncpg
import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from application_answers import ApplicantData
from utils.cv_pdf import resolve_cv_file

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


async def _mark_needs_manual(conn, application_id: str, message: str | None) -> None:
    """Nothing was submitted: needs_manual, and the auto-apply credit back.

    Quick apply's ATS path returns to Next.js before the form is filled, so
    Next.js's inline refunds don't see this outcome; until 2026-10-04 an
    application that ended here kept its credit. The refund follows
    lib/usage.ts refundAutoApplyForApplication: auto_apply_charged is cleared
    in the same UPDATE, so it happens at most once, and an application that
    was never charged (Tailor & Apply) is never refunded.
    """
    async with conn.transaction():
        await conn.execute(
            'UPDATE "Application" SET status = $1, applied_at = NOW(), error_message = $2 WHERE id = $3',
            "needs_manual",
            message,
            application_id,
        )
        charged = await conn.fetchrow(
            'UPDATE "Application" SET auto_apply_charged = false '
            "WHERE id = $1 AND auto_apply_charged = true RETURNING user_id",
            application_id,
        )
        if charged:
            await conn.execute(
                'UPDATE "UserUsage" SET "autoAppliesThisMonth" = "autoAppliesThisMonth" - 1, '
                '"totalAutoApplies" = "totalAutoApplies" - 1 '
                'WHERE "userId" = $1 AND "autoAppliesThisMonth" > 0',
                charged["user_id"],
            )
            print(f"[ats-apply] refunded the auto-apply for {application_id}")


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
                    timeout=300,
                )
            except asyncio.TimeoutError:
                print("[ats-apply-bg] TIMEOUT after 300s — submit_via_ats did not complete")
                result = {
                    "success": False,
                    "error": "timeout",
                    "message": "Apply timed out after 5 minutes",
                }
            print(f"[ats-apply-bg] Step 2: got result: {result}")

            print("[ats-apply-bg] Step 3: determining status")
            if result.get("success"):
                status = "applied"
            else:
                # Everything else — real field errors, unsolved captcha, an
                # unrecognized/unconfirmed page state, a timeout, or
                # Greenhouse's security-code gate (its code goes to our
                # server's browser session, not the user's, so there's
                # nothing to build a "finish" flow around — see CLAUDE.md)
                # — collapses into one actionable bucket: the user has to
                # go finish this one themselves. (Unhandled exceptions land
                # here too, via the except block below.)
                status = "needs_manual"
                reason = "captcha" if (result.get("captcha") or result.get("recaptcha")) else result.get("error", "unknown")
                print(f"[ats-apply-bg] form fill did not complete: {reason}")
            print(f"[ats-apply-bg] Step 4: status determined: {status}")

            print(f"[ats-apply-bg] Step 5: updating DB -> {status}")
            conn = await asyncpg.connect(os.environ["DATABASE_URL"])
            try:
                if status == "needs_manual":
                    await _mark_needs_manual(
                        conn, request_dict["application_id"], result.get("message") or result.get("error")
                    )
                else:
                    await conn.execute(
                        'UPDATE "Application" SET status = $1, applied_at = NOW(), error_message = NULL WHERE id = $2',
                        status,
                        request_dict["application_id"],
                    )
                print(f"[ats-apply-bg] Step 6: DB updated: {request_dict['application_id']} -> {status}")
            finally:
                await conn.close()

            # Both terminal outcomes get their own user email — applied and
            # needs_manual have distinct templates.
            print("[ats-apply-bg] Step 7: sending outcome email")
            await _send_application_confirmation_email(request_dict["application_id"])
            print("[ats-apply-bg] Step 8: outcome email step complete")

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
        # may be in an inconsistent state after the exception. An exception
        # is just another "could not complete" case, so it gets the same
        # needs_manual status and outcome email as any other one.
        async def _after_exception() -> None:
            conn = await asyncpg.connect(os.environ["DATABASE_URL"])
            try:
                await _mark_needs_manual(conn, request_dict["application_id"], error_text)
                print(f"[ats-apply-bg] DB updated after exception: {request_dict['application_id']} -> needs_manual")
            finally:
                await conn.close()
            await _send_application_confirmation_email(request_dict["application_id"])

        try:
            fail_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(fail_loop)
            fail_loop.run_until_complete(_after_exception())
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

        # Quick-apply path: no tailored CV yet — fall back to the user's CV row.
        # Fetched unconditionally (not just when tailored_cv is missing) because
        # resolve_cv_file() below needs source/original_file to decide whether
        # an uploaded CV must be passed through byte-for-byte.
        cv_row = await conn.fetchrow(
            'SELECT raw_text, source, original_file, original_filename, original_mime_type '
            'FROM "CV" WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
            req.user_id,
        )
        if not tailored_cv:
            if not cv_row or not cv_row["raw_text"]:
                return {"success": False, "error": "No CV uploaded — please upload your CV in Settings first"}
            print(f"[ats-apply] Quick-apply: using CV on file (source={cv_row['source']})")

        # The user's own answers — the only thing a factual question on the
        # form may be answered with (application_answers). The six Application
        # details count only once confirmed (application_details_confirmed_at);
        # they were read here regardless until 2026-10-04.
        profile_row = await conn.fetchrow(
            'SELECT first_name, last_name, email, phone, city, linkedin_url, github_url, '
            'portfolio_url, "currentCompany", expected_salary, notice_period, years_of_experience, '
            'highest_education, work_authorized, requires_sponsorship, willing_to_relocate, '
            'application_details_confirmed_at '
            'FROM "User" WHERE id = $1',
            req.user_id,
        )
        saved_rows = await conn.fetch(
            'SELECT question, answer FROM "EasyApplyAnswer" WHERE user_id = $1',
            req.user_id,
        )
        applicant = ApplicantData.from_row(
            dict(profile_row) if profile_row else {},
            [(r["question"], r["answer"]) for r in saved_rows],
        )
    finally:
        await conn.close()

    cv_row_dict = dict(cv_row) if cv_row else None
    resolved_cv = resolve_cv_file(tailored_cv or None, cv_row_dict)
    if resolved_cv is None:
        # A pre-migration CV row with no confirmed source — we can't prove
        # raw_text isn't the user's own uploaded words, so we refuse to guess
        # rather than risk silently re-rendering a real upload. This lands as
        # needs_manual with the normal confirmation email, not a silent
        # synchronous failure, and the dashboard also banners this state
        # (see /api/profile's cvNeedsReconfirmation).
        print(f"[ats-apply] CV can't be safely resolved for user {req.user_id} — landing as needs_manual")
        reup_conn = await asyncpg.connect(os.environ["DATABASE_URL"])
        try:
            await _mark_needs_manual(
                reup_conn,
                req.application_id,
                "We've upgraded how CV files are handled — please re-upload your CV or use Improve/Generate once, then apply again.",
            )
        finally:
            await reup_conn.close()
        await _send_application_confirmation_email(req.application_id)
        return {"success": True, "status": "needs_manual", "message": "Please re-upload or regenerate your CV to continue auto-applying."}

    cv_bytes, cv_filename = resolved_cv
    cv_base64 = base64.b64encode(cv_bytes).decode("ascii")
    print(f"[ats-apply] CV file size={len(cv_bytes)} bytes, base64 length={len(cv_base64)}, filename={cv_filename}")

    # An uploaded CV passed through byte-for-byte keeps its own filename —
    # anything else (tailored or AI-generated) gets our naming convention.
    is_passthrough = bool(
        cv_row_dict and cv_row_dict.get("source") == "uploaded" and cv_row_dict.get("original_file") and not tailored_cv
    )
    if not is_passthrough:
        name_part = f"{req.first_name}_{req.last_name}".strip("_").replace(" ", "_") or "applicant"
        ext = os.path.splitext(cv_filename)[1] or ".pdf"
        cv_filename = f"{name_part}_cv{ext}"

    # Best-effort text representation for any "paste your resume" style
    # fields — independent of which file is actually attached above.
    cv_text_for_fields = tailored_cv or (cv_row_dict.get("raw_text") if cv_row_dict else "") or ""

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
            "applicant": applicant,
            "cv_text": cv_text_for_fields,
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
