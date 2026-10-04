"""One scrape at a time. Until 2026-10-04 the scheduler and the Daily Scrape
workflow both started a full scrape at 05:00 UTC."""
import asyncio
from unittest.mock import AsyncMock, patch

import pytest

import scrape_runner


@pytest.fixture(autouse=True)
def _fresh_runner():
    scrape_runner._task = None
    scrape_runner._status.clear()
    yield
    scrape_runner._task = None


def test_second_start_while_running_joins_the_first():
    calls = []
    release = asyncio.Event()

    async def run(**kwargs):
        calls.append(kwargs)
        await release.wait()
        return {"new_jobs": 3}

    async def go():
        first, started1 = scrape_runner.ensure_running(run, trigger="scheduler")
        second, started2 = scrape_runner.ensure_running(run, trigger="api", skip_known=False)
        assert scrape_runner.status()["running"] is True
        release.set()
        return first, started1, second, started2, await second

    first, started1, second, started2, result = asyncio.run(go())
    assert (started1, started2) == (True, False)
    assert first is second
    assert calls == [{}]  # the api's options never ran
    assert result == {"new_jobs": 3}
    assert scrape_runner.status()["state"] == "finished"
    assert scrape_runner.status()["trigger"] == "scheduler"


def test_a_new_run_can_start_after_the_last_finished():
    async def run(**_):
        return {}

    async def go():
        t1, s1 = scrape_runner.ensure_running(run, trigger="a")
        await t1
        t2, s2 = scrape_runner.ensure_running(run, trigger="b")
        await t2
        return s1, s2

    assert asyncio.run(go()) == (True, True)


def test_a_failed_run_is_recorded_not_raised():
    async def run(**_):
        raise RuntimeError("linkedin down")

    async def go():
        task, _ = scrape_runner.ensure_running(run, trigger="scheduler")
        return await task

    assert asyncio.run(go()) is None
    st = scrape_runner.status()
    assert st["state"] == "failed" and "linkedin down" in st["error"] and st["running"] is False


def test_daily_pipeline_runs_scrape_then_active_jobs_then_match():
    import scheduler

    order = []

    async def fake_scrape(**_):
        order.append("scrape")
        return {}

    with (
        patch.object(scheduler, "run_scrape", fake_scrape),
        patch.object(scheduler, "_fetch_active_jobs", AsyncMock(side_effect=lambda: order.append("active_jobs"))),
        patch.object(scheduler, "_run_match_all", AsyncMock(side_effect=lambda: order.append("match"))),
    ):
        asyncio.run(scheduler._run_daily_pipeline())

    assert order == ["scrape", "active_jobs", "match"]


def test_scheduler_has_one_intake_job():
    import scheduler

    with patch.object(scheduler.scheduler, "start"):
        scheduler.start_scheduler()
    try:
        ids = sorted(job.id for job in scheduler.scheduler.get_jobs())
    finally:
        scheduler.scheduler.remove_all_jobs()
    assert ids == ["daily_pipeline", "startup_recovery"]
