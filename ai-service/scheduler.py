import logging
import os

import asyncpg
import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from routes.jobs import scrape_and_store
from routes.matching import MatchRequest, match_jobs

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

NEXTJS_URL = os.environ.get("NEXTJS_URL", "http://localhost:3000")
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")


async def _run_scrape():
    logger.info("[scheduler] Starting daily scrape…")
    try:
        result = await scrape_and_store()
        logger.info("[scheduler] Scrape done: %s", result)
    except Exception:
        logger.exception("[scheduler] Scrape failed")


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


def start_scheduler():
    scheduler.add_job(_run_scrape, CronTrigger(hour=5, minute=0, timezone="UTC"), id="daily_scrape")
    scheduler.add_job(_run_match_all, CronTrigger(hour=6, minute=0, timezone="UTC"), id="daily_match")
    scheduler.start()
    logger.info("[scheduler] Started — scrape@05:00 UTC, match@06:00 UTC")


def stop_scheduler():
    scheduler.shutdown(wait=False)
    logger.info("[scheduler] Stopped")
