"""Arbeitnow (free public API, no key): jobs in Germany, the UK, France and
Switzerland, sourced from employers' ATS boards.

Each job's url is Arbeitnow's own page; its /apply path redirects to the
employer's ATS. That redirect is read here and stored as apply_url, so a job
on Greenhouse, Lever or Ashby is stored 'auto' and can be quick-applied. In a
sample of 60 (2026-10-04), 37 landed on those three and most of the rest on
Personio, Recruitee or join.com, which we don't handle (stored 'external').

Terms: "free public API, please do not abuse ... appreciate linking back".
We fetch once a day, a page or two per site, and the job's link is the
Arbeitnow page.
"""
import asyncio
import os
import time
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import asyncpg
import httpx

from company_scraper import _html_to_text

# Each country site has jobs the .com feed lacks (2026-10-04: 75 of the last
# day's 100 .co.uk jobs were in .com), so all four are read. The site that
# hosts a job (its url) says which country it is in.
SITES = {
    "www.arbeitnow.com": "Germany",
    "www.arbeitnow.co.uk": "United Kingdom",
    "www.arbeitnow.fr": "France",
    "www.arbeitnow.ch": "Switzerland",
}
# The feed is only roughly newest-first: keep jobs from this window and stop
# at a page with none in it. 48h gives a job whose apply link couldn't be read
# (rate limit) a second run; jobs already stored cost nothing.
WINDOW_HOURS = 48
MAX_PAGES_PER_SITE = int(os.environ.get("ARBEITNOW_MAX_PAGES", "4"))
HEADERS = {"User-Agent": "JobAgent (https://jobagent.uk)"}

# Arbeitnow's site (Cloudflare) answers 429 to apply-link lookups made faster
# than about one a second — 28 of 60 at 0.5s apart, 2026-10-04. One at a time,
# this far apart, with a back-off when refused.
APPLY_DELAY_SECONDS = float(os.environ.get("ARBEITNOW_APPLY_DELAY_S", "2"))
_BACKOFF_SECONDS = (60, 120)


class RateLimited(Exception):
    def __init__(self, retry_after: float | None):
        super().__init__(f"429 (retry after {retry_after})")
        self.retry_after = retry_after

# Tracking parameters Arbeitnow adds to the ATS link. Anything else stays —
# a Greenhouse board embedded on a company site needs its gh_jid.
_TRACKING_PARAMS = {"ref", "source", "_pc", "pid"}


def clean_apply_url(url: str) -> str:
    parts = urlparse(url)
    query = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.startswith("utm_") and k not in _TRACKING_PARAMS
    ]
    # Drop the fragment too: Personio puts its tracking there (#apply?utm_…).
    return urlunparse(parts._replace(query=urlencode(query), fragment=""))


def job_location(raw: dict) -> str:
    """The job's location with its country, so a user who saved
    "United Kingdom" matches a job listed as "London"."""
    loc = " ".join((raw.get("location") or "").split())
    country = SITES.get(urlparse(raw.get("url") or "").netloc)
    if country and country.lower() not in loc.lower():
        loc = f"{loc}, {country}" if loc else country
    if raw.get("remote") and "remote" not in loc.lower():
        loc = f"{loc} (Remote)" if loc else "Remote"
    return loc


async def fetch_recent(client: httpx.AsyncClient, now: float | None = None) -> list[dict]:
    """Jobs created in the last WINDOW_HOURS from every site, one per slug."""
    now = now or time.time()
    since = now - WINDOW_HOURS * 3600
    jobs: dict[str, dict] = {}
    for site in SITES:
        for page in range(1, MAX_PAGES_PER_SITE + 1):
            resp = await client.get(f"https://{site}/api/job-board-api", params={"page": page})
            if resp.status_code != 200:
                print(f"[arbeitnow] {site} page {page}: HTTP {resp.status_code}")
                break
            body = resp.json()
            recent = [j for j in body.get("data", []) if (j.get("created_at") or 0) >= since]
            for j in recent:
                jobs.setdefault(j.get("slug") or j.get("url"), j)
            if not recent or not (body.get("links") or {}).get("next"):
                break
            await asyncio.sleep(1)
    return list(jobs.values())


async def resolve_apply_url(client: httpx.AsyncClient, job_url: str) -> str | None:
    """Where the job's Apply button goes: the employer's ATS, or None if it
    doesn't redirect off Arbeitnow. Raises RateLimited on a 429 — that is not
    an answer, and storing the job without its link would keep it 'external'."""
    try:
        resp = await client.get(job_url.rstrip("/") + "/apply", follow_redirects=False)
    except httpx.HTTPError as e:
        print(f"[arbeitnow] apply link failed for {job_url}: {e}")
        return None
    if resp.status_code == 429:
        retry_after = resp.headers.get("retry-after")
        raise RateLimited(float(retry_after) if retry_after and retry_after.isdigit() else None)
    target = resp.headers.get("location") if resp.is_redirect else None
    if not target or "arbeitnow." in urlparse(target).netloc:
        return None
    return clean_apply_url(target)


async def resolve_all(client: httpx.AsyncClient, raw_jobs: list[dict]) -> list[tuple[dict, str | None]]:
    """Apply links for the jobs, one at a time. When Arbeitnow keeps refusing
    after the back-offs, stop: the jobs not reached are left out (and come
    round again next run) rather than stored without their link."""
    resolved: list[tuple[dict, str | None]] = []
    for i, raw in enumerate(raw_jobs):
        for attempt in range(len(_BACKOFF_SECONDS) + 1):
            try:
                resolved.append((raw, await resolve_apply_url(client, raw["url"])))
                break
            except RateLimited as e:
                if attempt == len(_BACKOFF_SECONDS):
                    print(f"[arbeitnow] still rate limited; {len(raw_jobs) - i} jobs left for the next run")
                    return resolved
                wait = e.retry_after or _BACKOFF_SECONDS[attempt]
                print(f"[arbeitnow] rate limited, waiting {wait:.0f}s")
                await asyncio.sleep(wait)
        await asyncio.sleep(APPLY_DELAY_SECONDS)
    return resolved


def to_job(raw: dict, apply_url: str | None) -> dict | None:
    url = (raw.get("url") or "").strip()
    description = _html_to_text(raw.get("description") or "").strip()
    if not url or not description:
        return None
    return {
        "title": raw.get("title") or "",
        "company": raw.get("company_name") or "",
        "description": description,
        "location": job_location(raw),
        "url": url,  # Arbeitnow's page: the link we show, as their terms ask
        "apply_url": apply_url,
        "source": "arbeitnow",
        "salary_min": None,
        "salary_max": None,
    }


async def fetch_and_save_jobs() -> dict:
    from routes.jobs import upsert_job  # routes.jobs imports the scrapers; import late

    async with httpx.AsyncClient(timeout=20, headers=HEADERS) as client:
        raw_jobs = await fetch_recent(client)

        conn = await asyncpg.connect(os.environ["DATABASE_URL"])
        try:
            # Stored by yesterday's run (the window overlaps): skip the
            # apply-link lookup for those.
            stored = {
                r["url"] for r in await conn.fetch(
                    'SELECT url FROM "Job" WHERE url = ANY($1::text[])',
                    [j.get("url") for j in raw_jobs],
                )
            }
            new_raw = [j for j in raw_jobs if j.get("url") not in stored]
            resolved = await resolve_all(client, new_raw)

            new = skipped = 0
            for raw, apply_url in resolved:
                job = to_job(raw, apply_url)
                if job is None:
                    skipped += 1
                    continue
                await upsert_job(conn, job)
                new += 1
        finally:
            await conn.close()

    result = {
        "fetched": len(raw_jobs),
        "already_stored": len(raw_jobs) - len(new_raw),
        "new": new,
        "skipped": skipped,
        "with_ats_link": sum(1 for _, a in resolved if a),
        "left_for_next_run": len(new_raw) - len(resolved),
    }
    print(f"[arbeitnow] Done: {result}")
    return result


if __name__ == "__main__":
    asyncio.run(fetch_and_save_jobs())
