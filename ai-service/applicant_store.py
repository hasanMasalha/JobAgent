"""Loading what an application is filled with: the user's own answers and CV.

One place for it, used by the server-side applier (/ats-apply) and by the
extension's endpoints (routes/ats_extension.py), so both read the same
fields under the same rules.
"""

import os

from application_answers import ApplicantData
from utils.cv_pdf import resolve_cv_file


async def load_applicant(conn, user_id: str) -> ApplicantData:
    """The user's Profile and saved answers. The six Application details
    count only once confirmed (application_details_confirmed_at) — see
    ApplicantData.from_row."""
    profile_row = await conn.fetchrow(
        'SELECT first_name, last_name, email, phone, city, linkedin_url, github_url, '
        'portfolio_url, "currentCompany", expected_salary, notice_period, years_of_experience, '
        'highest_education, work_authorized, requires_sponsorship, willing_to_relocate, '
        'application_details_confirmed_at '
        'FROM "User" WHERE id = $1',
        user_id,
    )
    saved_rows = await conn.fetch(
        'SELECT question, answer FROM "EasyApplyAnswer" WHERE user_id = $1',
        user_id,
    )
    return ApplicantData.from_row(
        dict(profile_row) if profile_row else {},
        [(r["question"], r["answer"]) for r in saved_rows],
    )


async def load_cv_row(conn, user_id: str) -> dict | None:
    """The user's latest CV row, as utils.cv_pdf.resolve_cv_file expects it."""
    row = await conn.fetchrow(
        'SELECT raw_text, source, original_file, original_filename, original_mime_type '
        'FROM "CV" WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
        user_id,
    )
    return dict(row) if row else None


def application_cv_file(
    tailored_cv: str | None, cv_row: dict | None, first_name: str | None, last_name: str | None
) -> tuple[bytes, str] | None:
    """The CV file an application sends, and its filename — None when it
    can't be decided safely (see utils.cv_pdf.resolve_cv_file; the caller
    treats that as needs_manual / re-upload).

    An uploaded CV passed through byte-for-byte keeps its own filename;
    anything rendered (tailored or AI-generated) is named after the user.
    """
    resolved = resolve_cv_file(tailored_cv or None, cv_row)
    if resolved is None:
        return None
    cv_bytes, filename = resolved
    passthrough = bool(
        cv_row and cv_row.get("source") == "uploaded" and cv_row.get("original_file") and not tailored_cv
    )
    if not passthrough:
        name_part = f"{first_name or ''}_{last_name or ''}".strip("_").replace(" ", "_") or "applicant"
        ext = os.path.splitext(filename)[1] or ".pdf"
        filename = f"{name_part}_cv{ext}"
    return cv_bytes, filename
