"""Active Jobs DB (RapidAPI, Fantastic.jobs): jobs straight from ATS boards.

Until 2026-10-04 this fetched one page of 100 jobs a day with no location and
wrote them through Supabase REST without an embedding. Matching only reads
rows with an embedding, so none of those jobs ever reached anyone's matches.
The scheduler's run also used a key the server doesn't have, so its writes
were refused while the API quota was still spent.

Now it fetches per market (the same locations the scrape searches), pages
through each with location_filter, and stores through routes.jobs.upsert_job
like every other source, so each job is embedded.
"""
import asyncio
import os

import asyncpg
import httpx

from locations import api_location_name, fetch_user_locations, scrape_locations

RAPIDAPI_HOST = "active-jobs-db.p.rapidapi.com"
ENDPOINT = f"https://{RAPIDAPI_HOST}/active-ats"

# The plan is billed per job returned. 200 a day is what the double schedule
# used before (2 × 100), so this spends no more until the plan's quota is
# checked; raise ACTIVE_JOBS_MAX_PER_RUN then.
MAX_JOBS_PER_RUN = int(os.environ.get("ACTIVE_JOBS_MAX_PER_RUN", "200"))
PAGE_LIMIT = 100  # the API allows up to 1000


async def fetch_active_jobs(
    client: httpx.AsyncClient, location: str, limit: int, offset: int = 0
) -> list[dict] | None:
    """One page of the last 24h's jobs in a location. None on an API error."""
    resp = await client.get(
        ENDPOINT,
        headers={"X-RapidAPI-Key": os.environ.get("RAPIDAPI_KEY", ""), "X-RapidAPI-Host": RAPIDAPI_HOST},
        params={
            "time_frame": "24h",
            "limit": limit,
            "offset": offset,
            # Full names only ("United States", not "US"); see api_location_name.
            "location_filter": location,
            "description_format": "text",
        },
    )
    if resp.status_code != 200:
        print(f"[active-jobs] API error {resp.status_code} for {location}: {resp.text[:200]}")
        return None
    data = resp.json()
    return data if isinstance(data, list) else data.get("data", [])


async def fetch_market(client: httpx.AsyncClient, location: str, budget: int) -> list[dict]:
    """Page through a location's jobs until it runs out or budget is spent."""
    jobs: list[dict] = []
    while len(jobs) < budget:
        limit = min(PAGE_LIMIT, budget - len(jobs))
        page = await fetch_active_jobs(client, location, limit, offset=len(jobs))
        if not page:
            break
        jobs.extend(page)
        if len(page) < limit:  # the last page
            break
    return jobs


def to_job(raw: dict) -> dict | None:
    """An API record as a job for upsert_job, or None if it can't be stored."""
    url = (raw.get("url") or "").strip()
    description = (raw.get("description_text") or "").strip()
    if not url or not description:
        return None
    return {
        "title": raw.get("title") or "",
        "company": raw.get("organization") or "",
        "description": description,
        "location": (raw.get("locations_derived") or [""])[0] or "",
        "url": url,
        # The url is the ATS posting itself, so it is also where to apply.
        "apply_url": url,
        "source": "active_jobs_db",
        "salary_min": None,
        "salary_max": None,
    }


async def fetch_and_save_jobs(max_jobs: int = MAX_JOBS_PER_RUN) -> dict:
    from routes.jobs import upsert_job  # routes.jobs imports the scrapers; import late

    if not os.environ.get("RAPIDAPI_KEY"):
        print("[active-jobs] RAPIDAPI_KEY is not set; skipping")
        return {"new": 0, "updated": 0, "skipped": 0, "error": "RAPIDAPI_KEY not set"}

    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        markets = [api_location_name(loc) for loc in scrape_locations(await fetch_user_locations(conn))]
        # The cap is shared evenly so every market gets some of it.
        per_market = max(1, max_jobs // len(markets))

        raw_jobs: list[dict] = []
        by_market: dict[str, int] = {}
        async with httpx.AsyncClient(timeout=30) as client:
            for market in markets:
                got = await fetch_market(client, market, per_market)
                by_market[market] = len(got)
                raw_jobs.extend(got)
        print(f"[active-jobs] fetched {len(raw_jobs)} jobs: {by_market}")

        new = updated = skipped = 0
        seen: set[str] = set()
        for raw in raw_jobs:
            job = to_job(raw)
            if job is None or job["url"] in seen:
                skipped += 1
                continue
            seen.add(job["url"])
            if await upsert_job(conn, job):
                new += 1
            else:
                updated += 1
    finally:
        await conn.close()

    result = {"new": new, "updated": updated, "skipped": skipped, "by_market": by_market}
    print(f"[active-jobs] Done: {result}")
    return result


if __name__ == "__main__":
    asyncio.run(fetch_and_save_jobs())
