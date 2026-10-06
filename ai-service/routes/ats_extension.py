"""What the browser extension needs to fill an ATS application itself.

ATS applying moves into the user's browser (decided 2026-10-06): every ATS we
support runs a bot check, and our server's datacenter IP scores badly on all
of them. The server keeps every decision; the extension fills the page.

- POST /resolve-answers   the form's questions → each answer, or missing
- POST /ats-package       which form to open, and what to apply with
- POST /ats-package/cv    the CV file to upload

Called only through Next.js (X-Internal-Key), with the user id Next.js has
authenticated — never one from the caller. An application must be the user's
own and still draft or pending_extension.
"""

from __future__ import annotations

import base64
import json
import os

import asyncpg
from fastapi import APIRouter
from pydantic import BaseModel

from answer_resolver import MAX_CLAUDE_ANSWERS, Answer, Question, claude_answer, plan_answers
from applicant_store import application_cv_file, load_applicant, load_cv_row
from application_answers import normalize
from routes.ats_submit import _detect_ats

router = APIRouter()

OPEN_STATUSES = ("draft", "pending_extension")


class ApplicationRef(BaseModel):
    user_id: str
    application_id: str


class ResolveRequest(ApplicationRef):
    questions: list[dict]


async def _application(conn, user_id: str, application_id: str):
    return await conn.fetchrow(
        'SELECT a.id, a.status, a.tailored_cv, a.cover_letter, a.resolved_answers, '
        'j.title, j.company, j.url, j.apply_url '
        'FROM "Application" a JOIN "Job" j ON j.id = a.job_id '
        'WHERE a.id = $1 AND a.user_id = $2',
        application_id,
        user_id,
    )


def _closed(app) -> dict | None:
    if not app:
        return {"error": "not_found"}
    if app["status"] not in OPEN_STATUSES:
        return {"error": "not_open", "status": app["status"]}
    return None


def _cache(app) -> dict[str, str]:
    raw = app["resolved_answers"]
    if not raw:
        return {}
    data = json.loads(raw) if isinstance(raw, str) else raw
    return {k: v for k, v in (data.get("claude") or {}).items() if isinstance(v, str)}


@router.post("/resolve-answers")
async def resolve_answers(req: ResolveRequest):
    """Each question's answer, from the user's own data (facts), Claude
    (open-ended free text, cached per application), or nothing (missing).

    Claude answers are stored on the Application (resolved_answers.claude,
    keyed by the normalised question), so reloading the form doesn't call
    Claude again. At most MAX_CLAUDE_ANSWERS per application.
    """
    questions = [Question.from_dict(q) for q in req.questions[:200]]
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        app = await _application(conn, req.user_id, req.application_id)
        if closed := _closed(app):
            return closed
        applicant = await load_applicant(conn, req.user_id)
        cv_row = await load_cv_row(conn, req.user_id)
        cover_letter = app["cover_letter"] or ""
        answers, for_claude, missing = plan_answers(questions, applicant, cover_letter)

        cache = _cache(app)
        new: dict[str, str] = {}
        cv_text = app["tailored_cv"] or (cv_row or {}).get("raw_text") or ""
        for q in for_claude:
            key = normalize(q.label)
            text = cache.get(key) or new.get(key)
            if text is None and len(cache) + len(new) < MAX_CLAUDE_ANSWERS and cv_text:
                text = await claude_answer(q.label, cv_text)
                if text:
                    new[key] = text
            if text:
                answers.append(Answer(q.id, "claude", value=text))
            elif q.required:
                missing.append(q)

        if new:
            await conn.execute(
                'UPDATE "Application" SET resolved_answers = $1::jsonb WHERE id = $2',
                json.dumps({"claude": {**cache, **new}}),
                req.application_id,
            )
    finally:
        await conn.close()

    return {
        "answers": [a.to_dict() for a in answers],
        "missing": [{"id": q.id, "label": q.label or q.id} for q in missing],
    }


def form_url(url: str | None, apply_url: str | None) -> tuple[str | None, str]:
    """(the application form to open, which ATS). Greenhouse embedded on a
    company's own site (…?gh_jid=…) is Greenhouse; Lever's form is the
    posting URL + /apply."""
    target = apply_url or url or ""
    ats = _detect_ats(target) or ("greenhouse" if "gh_jid=" in target else None)
    if ats == "lever" and not target.rstrip("/").endswith("/apply"):
        target = target.rstrip("/") + "/apply"
    return (target or None), (ats or "unknown")


@router.post("/ats-package")
async def ats_package(req: ApplicationRef):
    """What the extension opens and applies with. The CV comes separately
    (/ats-package/cv) so this stays small."""
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        app = await _application(conn, req.user_id, req.application_id)
        if closed := _closed(app):
            return closed
    finally:
        await conn.close()

    target, ats = form_url(app["url"], app["apply_url"])
    if ats == "greenhouse" and target and "greenhouse.io" not in target:
        # The company page doesn't contain the form; open Greenhouse's own.
        from routes.ats_form_fill import _resolve_greenhouse_embed_url

        target = await _resolve_greenhouse_embed_url(target) or target
    return {
        "application_id": req.application_id,
        "status": app["status"],
        "ats": ats,
        "form_url": target,
        "job_title": app["title"],
        "company": app["company"],
        "cover_letter": app["cover_letter"] or "",
    }


@router.post("/ats-package/cv")
async def ats_package_cv(req: ApplicationRef):
    """The CV file to upload: the same file /ats-apply would send (tailored
    CV, else the user's own upload byte-for-byte, else the generated one)."""
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        app = await _application(conn, req.user_id, req.application_id)
        if closed := _closed(app):
            return closed
        applicant = await load_applicant(conn, req.user_id)
        cv_row = await load_cv_row(conn, req.user_id)
    finally:
        await conn.close()

    resolved = application_cv_file(app["tailored_cv"], cv_row, applicant.first_name, applicant.last_name)
    if resolved is None:
        return {"error": "cv_unavailable"}
    cv_bytes, filename = resolved
    mime = "application/pdf" if filename.lower().endswith(".pdf") else (
        (cv_row or {}).get("original_mime_type") or "application/octet-stream"
    )
    return {"filename": filename, "mime_type": mime, "base64": base64.b64encode(cv_bytes).decode("ascii")}
