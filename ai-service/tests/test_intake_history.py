"""Intake runs are recorded, time-limited and their problems named
(intake_history.py, scheduler._run_daily_pipeline). From 2026-10-20 to
2026-11-25 the pipeline stored nothing and nothing said so."""
import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

import active_jobs_fetcher as ajf
import intake_history
import scheduler
import scrape_runner


@pytest.fixture(autouse=True)
def _fresh_runner():
    scrape_runner._task = None
    scrape_runner._status.clear()
    yield
    scrape_runner._task = None


class History:
    """intake_history's writes, captured instead of going to the database."""

    def __init__(self):
        self.started, self.steps, self.finished = [], {}, None

    def patches(self):
        async def start(kind, trigger):
            self.started.append((kind, trigger))
            return "run-1"

        async def step(run_id, name, data):
            self.steps[name] = data

        async def finish(run_id, *, jobs_stored, problems, error=None):
            self.finished = {"jobs_stored": jobs_stored, "problems": problems, "error": error}

        return (
            patch.object(intake_history, "start_run", start),
            patch.object(intake_history, "record_step", step),
            patch.object(intake_history, "finish_run", finish),
        )


def run_pipeline(h: History, *, scrape, active=None, arbeitnow=None, match=None, timeouts=None):
    p1, p2, p3 = h.patches()
    report = AsyncMock()
    no_active = AsyncMock(return_value={"new": 0, "updated": 0, "by_market": {}})
    with (
        p1, p2, p3,
        patch.object(scheduler, "run_scrape", scrape),
        patch.object(scheduler, "_fetch_active_jobs", active or no_active),
        patch.object(scheduler, "_fetch_arbeitnow", arbeitnow or AsyncMock(return_value={"new": 0})),
        patch.object(scheduler, "_run_match_all", match or AsyncMock(return_value={"users": 1, "matched": 1, "failed": 0})),
        patch.object(scheduler, "_report_intake", report),
        patch.dict(scheduler.STEP_TIMEOUT_S, timeouts or {}),
    ):
        asyncio.run(scheduler._run_daily_pipeline())
    return report


def test_a_good_run_is_recorded_with_what_each_step_stored():
    h = History()

    async def scrape(**_):
        return {"new_jobs": 30, "updated_jobs": 70, "timing": {"big": "report"}}

    report = run_pipeline(
        h, scrape=scrape,
        active=AsyncMock(return_value={"new": 5, "updated": 1, "by_market": {"Israel": 6}, "api_errors": []}),
        arbeitnow=AsyncMock(return_value={"new": 12}),
    )
    assert h.started == [("daily", "scheduler")]
    assert list(h.steps) == ["scrape", "active_jobs", "arbeitnow", "match"]
    assert h.steps["scrape"]["stored"] == 100
    assert "timing" not in h.steps["scrape"]["result"]
    assert h.finished == {"jobs_stored": 118, "problems": [], "error": None}
    report.assert_awaited_once()  # the site is asked to check at once


def test_a_hung_step_is_cancelled_and_the_rest_still_run():
    """The 2026-10-20 failure: one step never returned, so nothing after it
    ran, that day or any day after."""
    h = History()

    async def hang(**_):
        await asyncio.sleep(3600)

    run_pipeline(h, scrape=hang, arbeitnow=AsyncMock(return_value={"new": 40}), timeouts={"scrape": 0.05})
    assert h.steps["scrape"]["status"] == "timed_out"
    assert h.steps["arbeitnow"]["status"] == "ok"
    assert h.steps["match"]["status"] == "ok"
    assert h.finished["jobs_stored"] == 40
    assert any("timed out" in p for p in h.finished["problems"])
    assert scrape_runner.is_running() is False  # tomorrow's run can start
    assert scrape_runner.status()["state"] == "cancelled"


def test_a_run_that_stores_nothing_says_so():
    h = History()

    async def scrape(**_):
        return {"new_jobs": 0, "updated_jobs": 0}

    run_pipeline(h, scrape=scrape)
    assert h.finished["jobs_stored"] == 0
    assert h.finished["problems"][0] == "The run stored 0 jobs"


def test_a_failed_scrape_is_a_problem_and_the_pipeline_goes_on():
    h = History()

    async def scrape(**_):
        raise RuntimeError("linkedin down")

    run_pipeline(h, scrape=scrape, arbeitnow=AsyncMock(return_value={"new": 3}))
    assert h.steps["scrape"]["status"] == "failed"
    assert "linkedin down" in h.steps["scrape"]["error"]
    assert h.steps["arbeitnow"]["stored"] == 3
    assert any(p.startswith("Scrape") and "linkedin down" in p for p in h.finished["problems"])


def test_active_jobs_db_refusing_every_market_is_a_problem():
    """2026-11-26: 400 for all six markets, 0 fetched, no error raised."""
    refused = {"status": "ok", "result": {"new": 0, "by_market": {"Israel": 0, "Germany": 0},
                                          "api_errors": ["Israel", "Germany"]}}
    assert intake_history.step_problems("active_jobs", refused) == [
        "Active Jobs DB: the API refused every market (Israel, Germany) — see the AI service log"
    ]
    partly = {"status": "ok", "result": {"new": 9, "by_market": {"Israel": 9, "Germany": 0}, "api_errors": ["Germany"]}}
    assert intake_history.step_problems("active_jobs", partly) == []


def test_fetch_market_lists_a_refused_location():
    errors: list[str] = []
    with patch.object(ajf, "fetch_active_jobs", AsyncMock(return_value=None)):
        assert asyncio.run(ajf.fetch_market(None, "Israel", 100, errors)) == []
    assert errors == ["Israel"]
    with patch.object(ajf, "fetch_active_jobs", AsyncMock(return_value=[])):
        asyncio.run(ajf.fetch_market(None, "Germany", 100, errors))
    assert errors == ["Israel"]  # no jobs is not an error


def test_match_all_counts_failures_but_not_users_without_a_cv():
    users = [{"id": "a"}, {"id": "b"}, {"id": "c"}]

    async def match(req):
        if req.user_id == "b":
            raise HTTPException(status_code=404, detail="CV not found for user")
        if req.user_id == "c":
            raise AttributeError("'list' object has no attribute 'get'")
        return [{"id": "j1"}]

    conn = AsyncMock()
    conn.fetch = AsyncMock(return_value=users)
    with (
        patch.dict("os.environ", {"DATABASE_URL": "postgres://test"}),
        patch.object(scheduler.asyncpg, "connect", AsyncMock(return_value=conn)),
        patch.object(scheduler, "match_jobs", match),
        patch.object(scheduler, "_notify_user_if_matches", AsyncMock()),
    ):
        result = asyncio.run(scheduler._run_match_all())
    assert result == {"users": 3, "matched": 1, "no_cv": 1, "failed": 1}
    assert intake_history.step_problems("match", {"status": "ok", "result": result}) == [
        "Matching failed for 1 of 3 user(s)"
    ]


def test_a_manual_scrape_gets_its_own_run_but_the_pipelines_does_not():
    h = History()
    p1, p2, p3 = h.patches()

    async def run(**_):
        return {"new_jobs": 0, "updated_jobs": 4}

    async def go():
        t, _ = scrape_runner.ensure_running(run, trigger="api")
        await t
        t, _ = scrape_runner.ensure_running(run, trigger="scheduler")
        await t

    with p1, p2, p3:
        asyncio.run(go())
    assert h.started == [("scrape", "api")]
    assert h.steps["scrape"]["stored"] == 4
    assert h.finished == {"jobs_stored": 4, "problems": [], "error": None}


def test_history_writes_never_break_intake():
    """No database (or no table): logged, and the run goes on."""
    with (
        patch.dict("os.environ", {"DATABASE_URL": "postgres://nowhere.invalid/x"}),
        patch.object(intake_history.asyncpg, "connect", AsyncMock(side_effect=OSError("unreachable"))),
    ):
        assert asyncio.run(intake_history.start_run("daily", "scheduler")) is None
        asyncio.run(intake_history.record_step("run-1", "scrape", {"status": "ok"}))
        asyncio.run(intake_history.finish_run("run-1", jobs_stored=0, problems=[]))
