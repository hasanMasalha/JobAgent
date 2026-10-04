"""Quick apply submits only to jobs stored as 'auto' (app/api/apply/quick).
Comeet was missing from the ATS list, so Comeet jobs were stored 'external'
and never quick-applied."""
import pytest

pytest.importorskip("asyncpg")
from routes.jobs import _detect_apply_type, _detect_ats  # noqa: E402

SUPPORTED = {
    "greenhouse": "https://job-boards.greenhouse.io/acme/jobs/123",
    "lever": "https://jobs.lever.co/acme/1f8c62e8",
    "workable": "https://apply.workable.com/acme/j/ABC123/",
    "ashby": "https://jobs.ashbyhq.com/acme/89962881",
    "comeet": "https://www.comeet.com/jobs/acme/30.000/backend-engineer/A1.B2C",
    "bamboohr": "https://acme.bamboohr.com/careers/42",
}


@pytest.mark.parametrize("ats, url", SUPPORTED.items())
def test_supported_ats_jobs_are_auto(ats, url):
    job = {"url": url, "apply_url": url, "description": "Great role"}
    assert _detect_apply_type(job) == "auto"
    assert _detect_ats(url, url) == ats
