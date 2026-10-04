import logging
import os
from datetime import timezone  # noqa: UP017

import asyncpg
import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

import scrape_runner
from active_jobs_fetcher import fetch_and_save_jobs as _fetch_active_jobs
from arbeitnow_fetcher import fetch_and_save_jobs as _fetch_arbeitnow
from routes.jobs import run_scrape
from routes.matching import MatchRequest, match_jobs

UTC = timezone.utc  # noqa: UP017 - datetime.UTC requires Python 3.11+

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

NEXTJS_URL = os.environ.get("NEXTJS_URL", "http://localhost:3000")
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")


async def _run_scrape(trigger: str = "scheduler"):
    """Run the daily scrape, or wait for the one already running (a manual
    run via POST /scrape-and-store). Company career pages are part of it."""
    logger.info("[scheduler] Starting daily scrape…")
    task, started = scrape_runner.ensure_running(run_scrape, trigger=trigger)
    if not started:
        logger.info("[scheduler] A scrape is already running; waiting for it")
    result = await task
    logger.info("[scheduler] Scrape done: %s", {k: v for k, v in (result or {}).items() if k != "timing"})


async def _run_daily_pipeline():
    """The only scheduled intake. Each step starts when the one before has
    finished, so matching never reads a half-stored scrape — the scrape has no
    time limit any more. Until 2026-10-04 these were separate jobs at fixed
    times (05:00, 05:15, 05:30, 06:00) and GitHub workflows started the scrape
    and the Active Jobs DB fetch a second time."""
    await _run_scrape()
    await _run_active_jobs_fetch()
    await _run_arbeitnow_fetch()
    await _run_match_all()


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
    try:
        result = await _fetch_active_jobs()
        logger.info("[scheduler] Active Jobs DB fetch done: %s", result)
    except Exception:
        logger.exception("[scheduler] Active Jobs DB fetch failed")


async def _run_arbeitnow_fetch():
    logger.info("[scheduler] Starting Arbeitnow fetch…")
    try:
        result = await _fetch_arbeitnow()
        logger.info("[scheduler] Arbeitnow fetch done: %s", result)
    except Exception:
        logger.exception("[scheduler] Arbeitnow fetch failed")


async def _run_match_all():
    logger.info("[scheduler] Starting daily match for all users…")
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)
    try:
        rows = await conn.fetch('SELECT id FROM "User"')
    finally:
        await conn.close()

    for row in rows:
        user_id = row["id"]
        try:
            result = await match_jobs(MatchRequest(user_id=user_id))
            match_count = len(result) if isinstance(result, list) else 0
            logger.info("[scheduler] Matched %d jobs for user %s", match_count, user_id)
            await _notify_user_if_matches(user_id, match_count)
        except Exception:
            logger.exception("[scheduler] Match failed for user %s", user_id)


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


def start_scheduler():
    # The only scheduled intake trigger; GitHub workflows run it manually only.
    scheduler.add_job(
        _run_daily_pipeline,
        CronTrigger(hour=5, minute=0, timezone="UTC"),
        id="daily_pipeline",
        max_instances=1,
        misfire_grace_time=3600,
    )
    # Fire a one-shot recovery check 5 seconds after startup so the event loop is ready
    from datetime import datetime, timedelta
    scheduler.add_job(_recovery_scrape_if_stale, "date",
                      run_date=datetime.now(UTC) + timedelta(seconds=5),
                      id="startup_recovery")
    scheduler.start()
    logger.info("[scheduler] Started — daily pipeline (scrape → Active Jobs DB → Arbeitnow → match) @05:00 UTC, recovery check in 5s")


def stop_scheduler():
    scheduler.shutdown(wait=False)
    logger.info("[scheduler] Stopped")
