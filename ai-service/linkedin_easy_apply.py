"""Whether a LinkedIn listing offers Easy Apply, read from its public job page.

LinkedIn's logged-out job page marks its apply button as on-site (the
application happens on LinkedIn — Easy Apply for a signed-in user) or off-site
(it leaves for the company's website):

    data-tracking-control-name="public_jobs_apply-link-onsite"
    data-tracking-control-name="public_jobs_apply-link-simple_onsite"
    data-impression-id="public_jobs_apply-link-offsite_contextual-sign-in-modal"

This is the only source of `apply_type = 'extension'` (routes/jobs.py,
_detect_apply_type). It needs no login and no extra request when the scraper
already has the page open. The names are LinkedIn's own and can change; when
neither marker is found the answer is None ("unknown"), which is stored as
external. Never guess True: the Extension badge and batch apply rely on it, and
the extension still checks for the button on the page before it does anything.

No Playwright or bs4 import here, so tests and the backfill script can use it
on plain HTML.
"""
import re

_ONSITE = re.compile(r"public_jobs_apply-link-(?:simple_)?onsite")
_OFFSITE = re.compile(r"public_jobs_apply-link-offsite")
_JOB_ID = re.compile(r"(\d{8,})")


def detect_easy_apply(html: str | None) -> bool | None:
    """True = on-site apply (Easy Apply), False = off-site, None = can't tell."""
    if not html:
        return None
    onsite = bool(_ONSITE.search(html))
    offsite = bool(_OFFSITE.search(html))
    if onsite == offsite:  # neither marker, or a page carrying both
        return None
    return onsite


def linkedin_job_id(url: str | None) -> str | None:
    """The numeric job id in a LinkedIn job URL (…/jobs/view/slug-4012345678)."""
    path = (url or "").split("?")[0]
    ids = _JOB_ID.findall(path)
    return ids[-1] if ids else None
