"""Ashby application forms (jobs.ashbyhq.com).

Until 2026-10-04 Ashby jobs went through the Greenhouse filler, which looks
for Greenhouse's #first_name and question_* ids — none of which exist on an
Ashby form — so Ashby submissions could not have worked.

Ashby's job page loads its form definition as JSON (GraphQL op
ApiJobPosting): every field's path, type, title, whether it's required and
its options. Each field is rendered in a container with
data-field-path="<path>". So the form is read from the JSON, answered from
the user's own data (application_answers — no defaults; Claude only for
open-ended free text), and filled by path.

Field types seen across 14 live postings (2026-10-04): String, Boolean,
LongText, File, Email, Phone, Location, ValueSelect, MultiValueSelect, plus
an optional EEO survey. A required field we have no answer for stops the
application before submit.

Outcome: success only on Ashby's own "Your application was successfully
submitted"; "We couldn't submit your application" (including a low
reCAPTCHA v3 score — Ashby runs invisible reCAPTCHA we can't solve) is a
failure. Anything else is unconfirmed, not success.
"""
import os
import re
import time
from dataclasses import dataclass

from application_answers import (
    ApplicantData,
    boolean_answer,
    claude_may_answer,
    is_decline_option,
    match_option,
    normalize,
    saved_answer,
    user_answer,
)

SUCCESS_TEXT = "your application was successfully submitted"
FAILURE_TEXT = "we couldn't submit your application"


@dataclass
class Action:
    path: str
    kind: str  # text | file | boolean | choice | multi | location | claude
    title: str
    value: str | None = None  # text, "yes"/"no", option label, city


def _options(field: dict) -> list[str]:
    return [o.get("label") or "" for o in (field.get("selectableValues") or [])]


def _entries(posting: dict) -> list[tuple[dict, bool, bool]]:
    """(field, required, is_survey) for the application form and EEO surveys."""
    out = []
    for section in (posting.get("applicationForm") or {}).get("sections") or []:
        for fe in section.get("fieldEntries") or []:
            out.append((fe.get("field") or {}, bool(fe.get("isRequired")), False))
    for survey in posting.get("surveyForms") or []:
        for section in survey.get("sections") or []:
            for fe in section.get("fieldEntries") or []:
                out.append((fe.get("field") or {}, bool(fe.get("isRequired")), True))
    return out


def plan(posting: dict, applicant: ApplicantData, cover_letter: str = "") -> tuple[list[Action], list[str]]:
    """What to fill and with what, and the required questions we have no
    answer for. Pure: no page, no Claude call (a "claude" action is answered
    when it's carried out)."""
    actions: list[Action] = []
    missing: list[str] = []

    for field, required, is_survey in _entries(posting):
        path, ftype, title = field.get("path") or "", field.get("type") or "", (field.get("title") or "").strip()
        if not path:
            continue
        action = None

        if is_survey:
            # Voluntary EEO: decline when it's required, otherwise leave it.
            if required:
                decline = next((o for o in _options(field) if is_decline_option(o)), None)
                if decline:
                    action = Action(path, "choice", title, decline)
        elif path == "_systemfield_name":
            action = Action(path, "text", title, applicant.full_name) if applicant.full_name else None
        elif path == "_systemfield_email":
            action = Action(path, "text", title, applicant.email) if applicant.email else None
        elif path == "_systemfield_resume":
            action = Action(path, "file", title)
        elif ftype == "Location":
            action = Action(path, "location", title, applicant.city) if applicant.city else None
        elif ftype == "Phone":
            action = Action(path, "text", title, applicant.phone) if applicant.phone else None
        elif ftype == "Boolean":
            saved = saved_answer(title, applicant)
            if saved and normalize(saved) in ("yes", "no"):
                action = Action(path, "boolean", title, normalize(saved))
            else:
                flag = boolean_answer(title, applicant)
                if flag is not None:
                    action = Action(path, "boolean", title, "yes" if flag else "no")
        elif ftype in ("ValueSelect", "MultiValueSelect"):
            options = _options(field)
            idx = match_option(options, user_answer(title, applicant))
            if idx != -1:
                action = Action(path, "choice" if ftype == "ValueSelect" else "multi", title, options[idx])
        elif ftype in ("String", "Email", "Number", "LongText"):
            answer = user_answer(title, applicant)
            if answer is None and ftype == "LongText" and cover_letter and "cover letter" in normalize(title):
                answer = cover_letter
            if answer is not None:
                action = Action(path, "text", title, answer)
            elif ftype == "LongText" and claude_may_answer(title, is_long_text=True):
                action = Action(path, "claude", title)
        # File (other than the resume), Date, Score…: not answered.

        if action:
            actions.append(action)
        elif required:
            missing.append(title or path)
    return actions, missing


def pick_location(options: list[str], city: str) -> int:
    """The suggestion that is the user's city, or -1. Ashby suggests several
    places per name ("London" also gives London, Ontario), so a city matches
    only when exactly one suggestion starts with it."""
    want = [p for p in (normalize(x) for x in city.split(",")) if p]
    if not want:
        return -1
    hits = [
        i for i, opt in enumerate(options)
        if [normalize(x) for x in opt.split(",")][: len(want)] == want
    ]
    return hits[0] if len(hits) == 1 else -1


async def _load_posting(page, apply_url: str) -> dict:
    """Open the application page and capture the form definition it loads."""
    captured: dict = {}

    async def on_response(resp):
        if "non-user-graphql" in resp.url and "ApiJobPosting" in resp.url:
            try:
                body = await resp.json()
                captured.update(((body.get("data") or {}).get("jobPosting")) or {})
            except Exception:
                pass

    page.on("response", on_response)
    url = apply_url.split("?")[0].rstrip("/")
    if not url.endswith("/application"):
        url += "/application"
    await page.goto(url, wait_until="networkidle", timeout=45000)
    await page.wait_for_timeout(1500)
    page.remove_listener("response", on_response)
    return captured


async def _do(page, action: Action, cv_path: str, cv_text: str) -> bool:
    from routes.ats_form_fill import _apply_react_value, _ask_claude_for_answer  # shared helpers

    box = page.locator(f'[data-field-path="{action.path}"]')
    if action.kind == "claude":
        action.value = await _ask_claude_for_answer(action.title, cv_text)
        if not action.value:
            return False
        action.kind = "text"

    if action.kind == "file":
        await page.locator(f"#{action.path}").set_input_files(cv_path)
    elif action.kind == "text":
        el = box.locator("input, textarea").first
        await el.click()
        await _apply_react_value(page, await el.element_handle(), action.value)
    elif action.kind == "boolean":
        await box.locator(f'button[data-option="{action.value}"]').click()
    elif action.kind in ("choice", "multi"):
        # Exact label text: a substring match would let "No" hit "Not represented here".
        exact = re.compile(rf"^\s*{re.escape(action.value)}\s*$")
        await box.locator("label").filter(has_text=exact).last.click()
    elif action.kind == "location":
        el = box.locator("input").first
        await el.fill(action.value)
        await page.wait_for_timeout(2000)
        options = await page.locator("[role=option]").all_inner_texts()
        idx = pick_location(options, action.value)
        if idx == -1:
            print(f"[ashby] location {action.value!r}: no single matching suggestion in {options[:5]}")
            await el.fill("")
            return False
        await page.locator("[role=option]").nth(idx).click()
    return True


async def fill_ashby_form(
    page, apply_url: str, cv_path: str, cover_letter: str, applicant: ApplicantData, cv_text: str
) -> dict:
    from routes.ats_form_fill import _missing_answers_result

    posting = await _load_posting(page, apply_url)
    if not posting.get("applicationForm"):
        return {"success": False, "error": "ashby_form_not_found", "ats": "ashby",
                "message": "Couldn't read this Ashby application form."}

    actions, missing = plan(posting, applicant, cover_letter)
    filled: list[str] = []
    if missing:
        print(f"[ashby] not submitting — no answer from the user for: {missing}")
        return _missing_answers_result(missing, filled)

    required_paths = {f.get("path") for f, req, _ in _entries(posting) if req}
    for action in actions:
        try:
            ok = await _do(page, action, cv_path, cv_text)
        except Exception as e:
            print(f"[ashby] could not fill {action.title!r}: {e}")
            ok = False
        if ok:
            filled.append(action.path)
        elif action.path in required_paths:
            missing.append(action.title or action.path)
    if missing:
        print(f"[ashby] not submitting — couldn't fill required: {missing}")
        return _missing_answers_result(missing, filled)

    try:
        os.makedirs("/app/screenshots", exist_ok=True)
        await page.screenshot(path=f"/app/screenshots/ashby_pre_submit_{int(time.time())}.png", full_page=True)
    except Exception as e:
        print(f"[ashby] pre-submit screenshot failed: {e}")

    await page.locator("button.ashby-application-form-submit-button").click()
    for _ in range(20):
        await page.wait_for_timeout(1000)
        body = (await page.inner_text("body")).lower()
        if SUCCESS_TEXT in body:
            return {"success": True, "filled": filled, "ats": "ashby"}
        if FAILURE_TEXT in body:
            return {"success": False, "error": "ashby_rejected", "filled": filled, "ats": "ashby",
                    "message": "Ashby didn't accept the application (it may have flagged it as automated). Apply on the employer's site."}
    return {"success": False, "error": "unconfirmed", "filled": filled, "ats": "ashby",
            "message": "Ashby showed no confirmation after submit — check the employer's site."}
