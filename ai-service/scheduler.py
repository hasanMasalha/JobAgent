import logging
import os
import asyncpg
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from routes.jobs import scrape_and_store
from routes.matching import match_jobs, MatchRequest

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def _run_scrape():
    logger.info("[scheduler] Starting daily scrape…")
    try:
        result = await scrape_and_store()
        logger.info("[scheduler] Scrape done: %s", result)
    except Exception:
        logger.exception("[scheduler] Scrape failed")


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
            await match_jobs(MatchRequest(user_id=user_id))
            logger.info("[scheduler] Matched jobs for user %s", user_id)
        except Exception:
            logger.exception("[scheduler] Match failed for user %s", user_id)


def start_scheduler():
    scheduler.add_job(_run_scrape, CronTrigger(hour=5, minute=0, timezone="UTC"), id="daily_scrape")
    scheduler.add_job(_run_match_all, CronTrigger(hour=6, minute=0, timezone="UTC"), id="daily_match")
    scheduler.start()
    logger.info("[scheduler] Started — scrape@05:00 UTC, match@06:00 UTC")


def stop_scheduler():
    scheduler.shutdown(wait=False)
    logger.info("[scheduler] Stopped")
