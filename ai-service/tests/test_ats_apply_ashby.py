"""routes/ats_apply: Ashby is never submitted from the server — its invisible
reCAPTCHA refuses our browser. Next.js sends Ashby jobs to fill-and-review;
/ats-apply refuses them before touching the database or starting a browser."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes import ats_apply

BODY = {
    "job_id": "job-1", "application_id": "app-1", "user_id": "user-1",
    "first_name": "Dana", "last_name": "Levi", "email": "dana@example.com",
}


@pytest.fixture
def client(monkeypatch):
    async def no_db(*_a, **_k):
        raise AssertionError("an Ashby request must not reach the database")

    def no_fill(*_a, **_k):
        raise AssertionError("an Ashby request must not start a form fill")

    monkeypatch.setattr(ats_apply.asyncpg, "connect", no_db)
    monkeypatch.setattr(ats_apply, "_run_ats_apply_sync", no_fill)
    app = FastAPI()
    app.include_router(ats_apply.router)
    return TestClient(app)


@pytest.mark.parametrize("platform, url", [
    ("ashby", "https://jobs.ashbyhq.com/acme/123"),
    # Named something else, but the form is Ashby's.
    ("greenhouse", "https://jobs.ashbyhq.com/acme/123/application"),
])
def test_ashby_is_refused_without_side_effects(client, platform, url):
    r = client.post("/ats-apply", json={**BODY, "ats_platform": platform, "apply_url": url})
    assert r.status_code == 200
    assert r.json()["success"] is False
    assert r.json()["error"] == "not_server_submitted"
