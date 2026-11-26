import asyncio
import logging
import os
import time
from datetime import timezone  # noqa: UP017

import asyncpg
import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import HTTPException

import intake_history
import scrape_runner
from exchange_rates import fetch_ecb, store_rates
from pending_release import release_stale_pending
from active_jobs_fetcher import fetch_and_save_jobs as _fetch_active_jobs
from arbeitnow_fetcher import fetch_and_save_jobs as _fetch_arbeitnow
from routes.jobs import run_scrape
from routes.matching import MatchRequest, match_jobs

UTC = timezone.utc  # noqa: UP017 - datetime.UTC requires Python 3.11+

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

NEXTJS_URL = os.environ.get("NEXTJS_URL", "http://localhost:3000")
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")


# Each step gets a time limit. The pipeline used to have none, and on
# 2026-10-20 one run never returned: with max_instances=1 APScheduler then
# skipped every 05:00 for five weeks (intake_history.py). A step over its
# limit is cancelled and recorded, and the next step runs. A thread one of
# them started may keep running, but the next day's run can start.
STEP_TIMEOUT_S = {
    "scrape": 3 * 3600,      # 49 min on 2026-11-26, after the five-week gap
    "active_jobs": 30 * 60,  # 200 jobs, six markets
    "arbeitnow": 2 * 3600,   # 2 s per new job's link lookup; 50 min for 1,248
    "match": 2 * 3600,
}


async def _run_scrape(trigger: str = "scheduler"):
    """Run the daily scrape, or wait for the one already running (a manual
    run via POST /scrape-and-store). Company career pages are part of it.
    Raises if the scrape failed, so the pipeline records it."""
    logger.info("[scheduler] Starting daily scrape…")
    task, started = scrape_runner.ensure_running(run_scrape, trigger=trigger)
    if not started:
        logger.info("[scheduler] A scrape is already running; waiting for it")
    result = await task
    if result is None:
        raise RuntimeError(scrape_runner.status().get("error") or "the scrape failed")
    logger.info("[scheduler] Scrape done: %s", intake_history.summary(result))
    return result


async def _step(run_id: str | None, name: str, run) -> dict:
    """One pipeline step under its time limit, recorded on the run. Never
    raises: the next step runs either way."""
    timeout = STEP_TIMEOUT_S[name]
    started = time.monotonic()
    data: dict = {"timeout_s": timeout}
    try:
        result = await asyncio.wait_for(run(), timeout)
        data.update(status="ok", result=intake_history.summary(result), stored=intake_history.stored_by(name, result))
    except TimeoutError:
        logger.error("[scheduler] %s timed out after %ss and was cancelled", name, timeout)
        data.update(status="timed_out", stored=0)
    except Exception as e:
        logger.exception("[scheduler] %s failed", name)
        data.update(status="failed", error=repr(e)[:500], stored=0)
    data["seconds"] = round(time.monotonic() - started)
    data["problems"] = intake_history.step_problems(name, data)
    await intake_history.record_step(run_id, name, data)
    return data


async def _run_daily_pipeline():
    """The only scheduled intake. Each step starts when the one before has
    finished, so matching never reads a half-stored scrape. Until 2026-10-04
    these were separate jobs at fixed times (05:00, 05:15, 05:30, 06:00) and
    GitHub workflows started the scrape and the Active Jobs DB fetch a second
    time. Each run is recorded in "IntakeRun" and reported to
    /api/admin/intake-health, which emails if something is wrong."""
    run_id = await intake_history.start_run("daily", "scheduler")
    steps: dict[str, dict] = {}
    error = None
    try:
        steps["scrape"] = await _step(run_id, "scrape", _run_scrape)
        steps["active_jobs"] = await _step(run_id, "active_jobs", _run_active_jobs_fetch)
        steps["arbeitnow"] = await _step(run_id, "arbeitnow", _run_arbeitnow_fetch)
        steps["match"] = await _step(run_id, "match", _run_match_all)
    except BaseException as e:  # cancelled at shutdown: still close the record
        error = repr(e)[:500]
        raise
    finally:
        stored = sum(d.get("stored", 0) for d in steps.values())
        problems = [p for d in steps.values() for p in d.get("problems", [])]
        if stored == 0 and "scrape" in steps:
            problems.insert(0, "The run stored 0 jobs")
        await intake_history.finish_run(run_id, jobs_stored=stored, problems=problems, error=error)
        await _report_intake()


async def _report_intake():
    """Ask the site to check intake now (it emails if this run went wrong).
    GitHub calls the same route every 6 h, so a failure here is caught later."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{NEXTJS_URL}/api/admin/intake-health",
                headers={"X-Internal-Key": INTERNAL_API_KEY},
                timeout=60,
            )
            logger.info("[scheduler] Intake health: %s %s", resp.status_code, resp.text[:300])
    except Exception:
        logger.exception("[scheduler] Reporting to /api/admin/intake-health failed")


async def _notify_user_if_matches(user_id: str, match_count: int):
    if match_count == 0:
        return
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{NEXTJS_URL}/api/email/send-matches",
                json={"user_id": user_id},
                headers={"X-Internal-Key": INTERNAL_API_KEY},
                timeout=30,
            )
            logger.info("[scheduler] Email notify user %s: %s", user_id, resp.text)
    except Exception:
        logger.exception("[scheduler] Email notify failed for user %s", user_id)


async def _run_active_jobs_fetch():
    logger.info("[scheduler] Starting Active Jobs DB fetch…")
    result = await _fetch_active_jobs()
    logger.info("[scheduler] Active Jobs DB fetch done: %s", result)
    return result


async def _run_arbeitnow_fetch():
    logger.info("[scheduler] Starting Arbeitnow fetch…")
    result = await _fetch_arbeitnow()
    logger.info("[scheduler] Arbeitnow fetch done: %s", result)
    return result


async def _run_match_all():
    logger.info("[scheduler] Starting daily match for all users…")
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)
    try:
        rows = await conn.fetch('SELECT id FROM "User"')
    finally:
        await conn.close()

    matched = no_cv = failed = 0
    for row in rows:
        user_id = row["id"]
        try:
            result = await match_jobs(MatchRequest(user_id=user_id))
            match_count = len(result) if isinstance(result, list) else 0
            matched += 1
            logger.info("[scheduler] Matched %d jobs for user %s", match_count, user_id)
            await _notify_user_if_matches(user_id, match_count)
        except HTTPException as e:
            if e.status_code != 404:  # 404 = no CV yet: nothing to match
                failed += 1
                logger.exception("[scheduler] Match failed for user %s", user_id)
            else:
                no_cv += 1
        except Exception:
            failed += 1
            logger.exception("[scheduler] Match failed for user %s", user_id)
    return {"users": len(rows), "matched": matched, "no_cv": no_cv, "failed": failed}


async def _recovery_scrape_if_stale():
    """Run an immediate scrape on startup if the newest job is older than 24 hours."""
    try:
        database_url = os.environ["DATABASE_URL"]
        conn = await asyncpg.connect(database_url)
        try:
            last_scraped = await conn.fetchval('SELECT MAX(scraped_at) FROM "Job"')
        finally:
            await conn.close()

        from datetime import datetime
        now = datetime.now(UTC)
        if last_scraped is None or (now - last_scraped.replace(tzinfo=UTC)).total_seconds() > 86400:
            age = "never" if last_scraped is None else f"{(now - last_scraped.replace(tzinfo=UTC)).days}d ago"
            logger.info("[scheduler] Recovery scrape triggered — last scrape was %s", age)
            await _run_scrape(trigger="startup recovery")
        else:
            logger.info("[scheduler] No recovery scrape needed — last scrape was recent")
    except Exception:
        logger.exception("[scheduler] Recovery scrape check failed")


async def _release_stale_pending():
    """Applications left with the extension too long: manual, credit back
    (pending_release.py)."""
    try:
        conn = await asyncpg.connect(os.environ["DATABASE_URL"])
        try:
            released = await release_stale_pending(conn)
        finally:
            await conn.close()
        if released:
            logger.info(f"[scheduler] Released {len(released)} stale pending_extension application(s): {released}")
    except Exception:
        logger.exception("[scheduler] Releasing stale pending_extension applications failed")


async def _refresh_exchange_rates():
    """The ECB's daily reference rates, for converting an expected salary
    (exchange_rates.py). A failure keeps the last ones; salary.py stops using
    them once they're too old."""
    try:
        rates = await fetch_ecb()
        conn = await asyncpg.connect(os.environ["DATABASE_URL"])
        try:
            await store_rates(conn, rates)
        finally:
            await conn.close()
        logger.info(f"[scheduler] Exchange rates for {rates.rate_date}: {len(rates.per_eur)} currencies")
    except Exception:
        logger.exception("[scheduler] Fetching the ECB exchange rates failed")


def start_scheduler():
    from datetime import datetime, timedelta

    # The only scheduled intake trigger; GitHub workflows run it manually only.
    scheduler.add_job(
        _run_daily_pipeline,
        CronTrigger(hour=5, minute=0, timezone="UTC"),
        id="daily_pipeline",
        max_instances=1,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        _release_stale_pending,
        "interval",
        minutes=15,
        id="release_stale_pending",
        max_instances=1,
        next_run_time=datetime.now(UTC) + timedelta(seconds=30),
    )
    scheduler.add_job(
        _refresh_exchange_rates,
        "interval",
        hours=6,
        id="exchange_rates",
        max_instances=1,
        next_run_time=datetime.now(UTC) + timedelta(seconds=60),
    )
    # Fire a one-shot recovery check 5 seconds after startup so the event loop is ready
    scheduler.add_job(_recovery_scrape_if_stale, "date",
                      run_date=datetime.now(UTC) + timedelta(seconds=5),
                      id="startup_recovery")
    scheduler.start()
    logger.info("[scheduler] Started — daily pipeline (scrape → Active Jobs DB → Arbeitnow → match) @05:00 UTC, "
                "stale pending_extension release every 15 min, ECB exchange rates every 6 h, recovery check in 5s")


def stop_scheduler():
    scheduler.shutdown(wait=False)
    logger.info("[scheduler] Stopped")
