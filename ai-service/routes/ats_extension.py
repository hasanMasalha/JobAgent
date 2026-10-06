"""What the browser extension needs to fill an ATS application itself.

ATS applying moves into the user's browser (decided 2026-10-06): every ATS we
support runs a bot check, and our server's datacenter IP scores badly on all
of them. The server keeps every decision; the extension fills the page.

- POST /resolve-answers   the form's questions → each answer, or missing
- POST /ats-package       which form to open, and what to apply with
- POST /ats-package/cv    the CV file to upload
- POST /form-answers      the real form's questions and answers (fill-and-review page)

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
from form_questions import form_questions
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


async def _resolve(conn, user_id: str, app, questions: list[Question]) -> tuple[list[Answer], list[Question]]:
    """(answers, missing) for these questions on this application: facts from
    the user's own data, Claude for open-ended free text (cached on the
    Application, at most MAX_CLAUDE_ANSWERS), nothing otherwise."""
    applicant = await load_applicant(conn, user_id)
    cv_row = await load_cv_row(conn, user_id)
    answers, for_claude, missing = plan_answers(questions, applicant, app["cover_letter"] or "")

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
            app["id"],
        )
    return answers, missing


def _result(answers: list[Answer], missing: list[Question]) -> dict:
    return {
        "answers": [a.to_dict() for a in answers],
        "missing": [{"id": q.id, "label": q.label or q.id} for q in missing],
    }


@router.post("/resolve-answers")
async def resolve_answers(req: ResolveRequest):
    """Each question's answer, from the user's own data (facts), Claude
    (open-ended free text, cached per application), or nothing (missing)."""
    questions = [Question.from_dict(q) for q in req.questions[:200]]
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        app = await _application(conn, req.user_id, req.application_id)
        if closed := _closed(app):
            return closed
        answers, missing = await _resolve(conn, req.user_id, app, questions)
    finally:
        await conn.close()
    return _result(answers, missing)


def form_url(url: str | None, apply_url: str | None) -> tuple[str | None, str]:
    """(the application form to open, which ATS). Greenhouse embedded on a
    company's own site (…?gh_jid=…) is Greenhouse; Lever's form is the
    posting URL + /apply."""
    target = apply_url or url or ""
    ats = _detect_ats(target) or ("greenhouse" if "gh_jid=" in target else None)
    if ats == "lever" and not target.rstrip("/").endswith("/apply"):
        target = target.rstrip("/") + "/apply"
    return (target or None), (ats or "unknown")


async def _form_target(app) -> tuple[str | None, str]:
    """(form URL, ATS) for this application's job, with Greenhouse embedded
    on a company site resolved to Greenhouse's own form."""
    target, ats = form_url(app["url"], app["apply_url"])
    if ats == "greenhouse" and target and "greenhouse.io" not in target:
        # The company page doesn't contain the form; open Greenhouse's own.
        from routes.ats_form_fill import _resolve_greenhouse_embed_url

        target = await _resolve_greenhouse_embed_url(target) or target
    return target, ats


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

    target, ats = await _form_target(app)
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


@router.post("/form-answers")
async def form_answers(req: ApplicationRef):
    """For the fill-and-review page: the real form's questions (read without
    a browser, form_questions.py) and the answer to each — the same answers
    and Claude cache the extension gets. supported=False for an ATS whose
    form we can't read yet (only Greenhouse and Ashby so far)."""
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        app = await _application(conn, req.user_id, req.application_id)
        if closed := _closed(app):
            return closed
        target, ats = await _form_target(app)
        questions = await form_questions(ats, target) if target else None
        if not questions:
            return {"supported": False, "ats": ats, "form_url": target}
        answers, missing = await _resolve(conn, req.user_id, app, questions)
    finally:
        await conn.close()
    return {
        "supported": True,
        "ats": ats,
        "form_url": target,
        "questions": [
            {"id": q.id, "label": q.label, "kind": q.kind, "required": q.required, "role": q.role, "eeo": q.eeo}
            for q in questions
        ],
        **_result(answers, missing),
    }
