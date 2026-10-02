"""apply_type 'extension' must mean LinkedIn itself marked the job as on-site
apply (Easy Apply). The Extension badge and batch apply rely on it, so an
unknown page is None — never a guess."""
import pytest

from linkedin_easy_apply import detect_easy_apply, linkedin_job_id

ONSITE = '<button class="apply-button" data-tracking-control-name="public_jobs_apply-link-onsite">Apply</button>'
SIMPLE_ONSITE = '<button data-tracking-control-name="public_jobs_apply-link-simple_onsite">Apply</button>'
OFFSITE = (
    '<div class="contextual-sign-in-modal" '
    'data-impression-id="public_jobs_apply-link-offsite_contextual-sign-in-modal"></div>'
)


@pytest.mark.parametrize("html", [ONSITE, SIMPLE_ONSITE, f"<html><body>{ONSITE}</body></html>"])
def test_onsite_marker_is_easy_apply(html):
    assert detect_easy_apply(html) is True


def test_offsite_marker_is_not_easy_apply():
    assert detect_easy_apply(OFFSITE) is False


@pytest.mark.parametrize(
    "html",
    [
        None,
        "",
        "<html><body>Sign in to LinkedIn</body></html>",
        # The words alone aren't the marker: a description can mention them.
        "<p>We support Easy Apply and onsite interviews</p>",
        # Both markers on one page: can't tell which is this job's button.
        ONSITE + OFFSITE,
    ],
)
def test_no_clear_marker_is_unknown(html):
    assert detect_easy_apply(html) is None


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://www.linkedin.com/jobs/view/4012345678", "4012345678"),
        ("https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4012345678", "4012345678"),
        ("https://il.linkedin.com/jobs/view/senior-engineer-at-acme-4012345678?originalSubdomain=il", "4012345678"),
        ("https://www.linkedin.com/jobs/view/top-10-roles-2026-at-acme-4012345678/", "4012345678"),
        ("https://www.linkedin.com/jobs/search", None),
        (None, None),
    ],
)
def test_job_id_from_url(url, expected):
    assert linkedin_job_id(url) == expected


def test_stored_apply_type_follows_the_flag():
    """routes/jobs.py: only a confirmed Easy Apply listing is 'extension', and
    a recruiter email still wins ('auto')."""
    pytest.importorskip("asyncpg")
    try:
        from routes.jobs import _detect_apply_type
    except Exception as e:  # heavy imports (embedder, Playwright) missing locally
        pytest.skip(f"routes.jobs not importable here: {e}")

    url = "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4012345678"
    assert _detect_apply_type({"url": url, "description": "Great role", "is_easy_apply": True}) == "extension"
    assert _detect_apply_type({"url": url, "description": "Great role", "is_easy_apply": False}) == "external"
    assert _detect_apply_type({"url": url, "description": "Great role", "is_easy_apply": None}) == "external"
    assert _detect_apply_type({"url": url, "description": "Great role"}) == "external"
    assert _detect_apply_type({"url": url, "description": "Send your CV to jobs@acme.example", "is_easy_apply": True}) == "auto"
