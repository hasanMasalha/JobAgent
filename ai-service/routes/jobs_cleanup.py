import asyncio
import os
import sys
import asyncpg
import aiohttp
from fastapi import APIRouter

router = APIRouter()

CLOSED_SIGNALS = [
    "no longer accepting applications",
    "closed-job__flavor--closed",
    "closed-job",
    "not accepting applications",
    "this job is closed",
    "position has been filled",
    "job has expired",
    "application deadline has passed",
]


async def check_linkedin_job_closed(
    session: aiohttp.ClientSession,
    url: str,
) -> bool:
    """
    Returns True if job is closed/no longer accepting.
    Returns False if still open or if we can't tell.
    """
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Cache-Control": "max-age=0",
        }
        async with session.get(
            url,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=10),
            allow_redirects=True,
            ssl=False,
        ) as resp:
            print(f"[check_job] {url[:60]} → status: {resp.status}")

            if resp.status == 404:
                return True  # Job deleted
            if resp.status != 200:
                print(f"[check_job] non-200: {resp.status}")
                return False  # Can't tell — assume open

            html = await resp.text()
            html_lower = html.lower()

            print(f"[check_job] html preview: {html[:200]}")

            for signal in CLOSED_SIGNALS:
                if signal in html_lower:
                    print(f"[check_job] CLOSED signal found: {signal}")
                    return True

            return False

    except asyncio.TimeoutError:
        return False  # Timeout — assume still open
    except Exception as e:
        print(f"[check_job] error checking {url}: {e}", file=sys.stderr)
        return False  # Error — assume still open


async def run_linkedin_closed_check(
    batch_size: int = 200,
    days_old: int = 3,
) -> dict:
    """
    Check LinkedIn jobs that are N+ days old for closure.
    Process in batches to avoid rate limiting.
    """
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        return {"error": "no DATABASE_URL"}

    conn = await asyncpg.connect(database_url)

    try:
        jobs = await conn.fetch(f"""
            SELECT id, url, title, company
            FROM "Job"
            WHERE is_active = true
              AND url LIKE '%linkedin.com%'
              AND scraped_at < NOW() - INTERVAL '{days_old} days'
            ORDER BY scraped_at DESC
            LIMIT {batch_size}
        """)

        print(f"[linkedin_check] checking {len(jobs)} jobs...")

        deactivated = 0
        checked = 0
        semaphore = asyncio.Semaphore(3)

        async def check_one(job):
            nonlocal deactivated, checked
            async with semaphore:
                is_closed = await check_linkedin_job_closed(session, job["url"])
                checked += 1
                if is_closed:
                    await conn.execute(
                        'UPDATE "Job" SET is_active = false WHERE id = $1',
                        job["id"],
                    )
                    deactivated += 1
                    print(
                        f"[linkedin_check] deactivated: "
                        f"{job['title']} at {job['company']}"
                    )
                await asyncio.sleep(0.5)

        connector = aiohttp.TCPConnector(limit=5)
        async with aiohttp.ClientSession(connector=connector) as session:
            tasks = [check_one(job) for job in jobs]
            await asyncio.gather(*tasks)

        result = {
            "checked": checked,
            "deactivated": deactivated,
            "still_active": checked - deactivated,
        }
        print(f"[linkedin_check] complete: {result}")
        return result

    finally:
        await conn.close()


@router.post("/check-closed-jobs")
async def check_closed_jobs_endpoint(
    batch_size: int = 200,
    days_old: int = 3,
):
    """Check LinkedIn jobs older than days_old for closure."""
    return await run_linkedin_closed_check(
        batch_size=batch_size,
        days_old=days_old,
    )


async def run_recent_closed_check(batch_size: int = 100) -> dict:
    """
    Check LinkedIn jobs posted in the last 3 days for fast closure.
    Some jobs fill within hours and should be deactivated quickly.
    """
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        return {"error": "no DATABASE_URL"}

    conn = await asyncpg.connect(database_url)
    try:
        jobs = await conn.fetch(f"""
            SELECT id, url, title, company
            FROM "Job"
            WHERE is_active = true
              AND url LIKE '%linkedin.com%'
              AND scraped_at > NOW() - INTERVAL '3 days'
            ORDER BY scraped_at DESC
            LIMIT {batch_size}
        """)

        print(f"[recent_check] checking {len(jobs)} jobs")
        deactivated = 0
        checked = 0
        semaphore = asyncio.Semaphore(3)

        async def check_one(job):
            nonlocal deactivated, checked
            async with semaphore:
                is_closed = await check_linkedin_job_closed(session, job["url"])
                checked += 1
                if is_closed:
                    await conn.execute(
                        'UPDATE "Job" SET is_active = false WHERE id = $1',
                        job["id"],
                    )
                    deactivated += 1
                    print(
                        f"[recent_check] closed: "
                        f"{job['title']} at {job['company']}"
                    )
                await asyncio.sleep(0.5)

        connector = aiohttp.TCPConnector(limit=5)
        async with aiohttp.ClientSession(connector=connector) as session:
            await asyncio.gather(*[check_one(job) for job in jobs])

        return {"checked": checked, "deactivated": deactivated}
    finally:
        await conn.close()


@router.post("/check-recent-closed")
async def check_recent_closed_endpoint(batch_size: int = 100):
    """Check very recent LinkedIn jobs (0-3 days) for fast closure."""
    return await run_recent_closed_check(batch_size)


@router.get("/test-job-check")
async def test_job_check(url: str):
    """Test if a specific job URL is detected as closed."""
    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        is_closed = await check_linkedin_job_closed(session, url)
        return {"url": url, "is_closed": is_closed}
