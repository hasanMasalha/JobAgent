"""The questions on an ATS application form, read without a browser.

For the fill-and-review page (the user applies by hand with JobAgent's
answers next to them), and later for checking what the extension read.

- Greenhouse: its public job board API returns the form
  (boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}?questions=true).
- Ashby: the same form request the job page makes for itself
  (jobs.ashbyhq.com/api/non-user-graphql, ApiJobPosting) — a read; Ashby's
  bot check runs on submit, not here.

Both come back as answer_resolver.Question, so the answers are decided by
the same rules as everywhere else. Other ATSs: None (not supported yet).
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

import httpx

from answer_resolver import Question

_TIMEOUT = 20
_HEADERS = {"User-Agent": "JobAgent (https://jobagent.uk)"}


# ── Greenhouse ──────────────────────────────────────────────────────────────

def greenhouse_ids(form_url: str) -> tuple[str, str] | None:
    """(board token, job id) from a Greenhouse form or listing URL."""
    parts = urlsplit(form_url or "")
    query = parse_qs(parts.query)
    if query.get("for") and query.get("token"):  # …/embed/job_app?for=acme&token=123
        return query["for"][0], query["token"][0]
    m = re.search(r"greenhouse\.io/([^/?#]+)/jobs/(\d+)", form_url or "")
    return (m.group(1), m.group(2)) if m else None


_GH_ROLES = {
    "first_name": "first_name", "last_name": "last_name", "email": "email",
    "phone": "phone", "resume": "resume", "cover_letter": "cover_letter",
}
_GH_KINDS = {
    "input_text": "text",
    "textarea": "long_text",
    "multi_value_single_select": "select",
    "multi_value_multi_select": "multi_select",
    "input_file": "file",
}


def greenhouse_form(job: dict) -> list[Question]:
    """Questions from the job board API's job (with questions=true)."""
    out: list[Question] = []

    def add(q: dict, eeo: bool = False, kind_override: str | None = None):
        fields = [f for f in (q.get("fields") or []) if f.get("type") != "input_hidden"]
        if not fields:
            return
        # Resume / cover letter come as a file field plus a paste-in textarea.
        main = next((f for f in fields if f.get("name") in _GH_ROLES), fields[0])
        name = main.get("name") or ""
        out.append(Question(
            id=name,
            label=(q.get("label") or "").strip(),
            kind=kind_override or _GH_KINDS.get(main.get("type"), "text"),
            required=bool(q.get("required")),
            options=[v.get("label") or "" for v in (main.get("values") or []) if v.get("label")],
            role=_GH_ROLES.get(name),
            eeo=eeo,
        ))

    for q in job.get("questions") or []:
        add(q)
    for q in job.get("location_questions") or []:
        add(q, kind_override="location")
    for section in job.get("compliance") or []:  # US EEO self-identification
        for q in section.get("questions") or []:
            add(q, eeo=True)
    # Voluntary demographic questions: their own shape (answer_options, no fields).
    demographic = job.get("demographic_questions") or {}
    for q in demographic.get("questions") or []:
        out.append(Question(
            id=f"demographic_{q.get('id')}",
            label=(q.get("label") or "").strip(),
            kind=_GH_KINDS.get(q.get("type"), "select"),
            required=bool(q.get("required")),
            options=[a.get("label") or "" for a in (q.get("answer_options") or []) if a.get("label")],
            eeo=True,
        ))
    return out


async def greenhouse_questions(form_url: str) -> list[Question] | None:
    ids = greenhouse_ids(form_url)
    if not ids:
        return None
    board, job_id = ids
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
        r = await client.get(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job_id}?questions=true")
    if r.status_code != 200:
        return None
    return greenhouse_form(r.json())


# ── Ashby ───────────────────────────────────────────────────────────────────

_ASHBY_QUERY = """query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id
    title
    applicationForm { sections { isHidden fieldEntries { id field isRequired isHidden } } }
    surveyForms { sections { isHidden fieldEntries { id field isRequired isHidden } } }
  }
}"""


def ashby_ids(form_url: str) -> tuple[str, str] | None:
    """(organisation, posting id) from jobs.ashbyhq.com/{org}/{id}[/application]."""
    m = re.search(r"jobs\.ashbyhq\.com/([^/?#]+)/([0-9a-f-]{36})", form_url or "")
    return (m.group(1), m.group(2)) if m else None


_ASHBY_KINDS = {
    "String": "text", "Email": "email", "Phone": "phone", "Number": "number",
    "LongText": "long_text", "Boolean": "boolean", "ValueSelect": "select",
    "MultiValueSelect": "multi_select", "Location": "location", "File": "file", "Date": "date",
}
_ASHBY_ROLES = {
    "_systemfield_name": "full_name", "_systemfield_email": "email",
    "_systemfield_resume": "resume", "_systemfield_phone": "phone",
}


def ashby_form(posting: dict) -> list[Question]:
    out: list[Question] = []

    def sections(form):
        return [s for s in ((form or {}).get("sections") or []) if not s.get("isHidden")]

    groups = [(s, False) for s in sections(posting.get("applicationForm"))]
    for survey in posting.get("surveyForms") or []:
        groups += [(s, True) for s in sections(survey)]

    for section, eeo in groups:
        for fe in section.get("fieldEntries") or []:
            if fe.get("isHidden"):
                continue
            f = fe.get("field") or {}
            path, title, ftype = f.get("path") or "", (f.get("title") or "").strip(), f.get("type") or ""
            if not path:
                continue
            role = _ASHBY_ROLES.get(path)
            if not role and ftype == "File" and "cover letter" in title.lower():
                role = "cover_letter"
            if not role and ftype == "Phone":
                role = "phone"
            out.append(Question(
                id=path,
                label=title,
                kind=_ASHBY_KINDS.get(ftype, "text"),
                required=bool(fe.get("isRequired")),
                options=[o.get("label") or "" for o in (f.get("selectableValues") or []) if o.get("label")],
                role=role,
                eeo=eeo,
            ))
    return out


async def ashby_questions(form_url: str) -> list[Question] | None:
    ids = ashby_ids(form_url)
    if not ids:
        return None
    org, posting_id = ids
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
        r = await client.post(
            "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting",
            json={
                "operationName": "ApiJobPosting",
                "query": _ASHBY_QUERY,
                "variables": {"organizationHostedJobsPageName": org, "jobPostingId": posting_id},
            },
        )
    if r.status_code != 200:
        return None
    posting = ((r.json().get("data") or {}).get("jobPosting")) or None
    return ashby_form(posting) if posting else None


async def form_questions(ats: str, form_url: str) -> list[Question] | None:
    """The form's questions, or None when this ATS isn't supported yet or the
    form couldn't be read."""
    try:
        if ats == "greenhouse":
            return await greenhouse_questions(form_url)
        if ats == "ashby":
            return await ashby_questions(form_url)
    except (httpx.HTTPError, ValueError) as e:
        print(f"[form-questions] {ats} {form_url[:80]}: {e}")
    return None
