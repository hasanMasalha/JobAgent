import asyncio
import re

import aiohttp
from jobspy import scrape_jobs

from company_scraper import scrape_all_company_careers
from linkedin_fetcher import fetch_all_linkedin_jobs
from scraper_alljobs import scrape_alljobs
from scraper_drushim import scrape_drushim

SEARCH_TERMS = [
    "software engineer",
    "backend developer",
    "frontend developer",
    "full stack developer",
    "data engineer",
    "devops engineer",
    "product manager",
    "QA engineer",
]


async def scrape_israel_jobs() -> list[dict]:
    seen_urls: set[str] = set()
    results: list[dict] = []

    for term in SEARCH_TERMS:
        try:
            df = await asyncio.to_thread(
                scrape_jobs,
                site_name=["indeed"],
                search_term=term,
                location="Israel",
                country_indeed="Israel",
                results_wanted=50,
                hours_old=168,
            )
        except Exception as e:
            print(f"[scraper] error scraping '{term}': {e}")
            await asyncio.sleep(2)
            continue

        for _, row in df.iterrows():
            url = str(row.get("job_url") or "").strip()
            if not url or url in seen_urls:
                continue

            description = _clean(row.get("description"))
            if not description:
                continue  # skip jobs with no description

            seen_urls.add(url)

            salary_min = _safe_int(row.get("min_amount"))
            salary_max = _safe_int(row.get("max_amount"))

            results.append(
                {
                    "title": _clean(row.get("title")),
                    "company": _clean(row.get("company")),
                    "description": description,
                    "location": _clean(row.get("location")),
                    "url": url,
                    "source": _clean(row.get("site")),
                    "salary_min": salary_min,
                    "salary_max": salary_max,
                }
            )

        await asyncio.sleep(2)

    # Add LinkedIn feed results, deduplicating by URL
    print("Starting LinkedIn feed scrape...")
    try:
        linkedin_jobs = await fetch_all_linkedin_jobs()
        for job in linkedin_jobs:
            url = job.get("url", "").strip()
            if url and url not in seen_urls:
                seen_urls.add(url)
                results.append(job)
    except Exception as e:
        print(f"[scraper] LinkedIn feed scrape failed: {e}")

    # Add Drushim and Alljobs results, deduplicating by URL
    for extra in await asyncio.gather(scrape_drushim(), scrape_alljobs(), return_exceptions=True):
        if isinstance(extra, Exception):
            print(f"[scraper] extra scraper failed: {extra}")
            continue
        for job in extra:
            url = job.get("url", "").strip()
            if url and url not in seen_urls and job.get("description", "").strip():
                seen_urls.add(url)
                results.append(job)

    # Add company careers results, deduplicating by URL
    print("Starting company careers scrape...")
    try:
        company_jobs = await scrape_all_company_careers()
        for job in company_jobs:
            url = job.get("url", "").strip()
            if url and url not in seen_urls:
                seen_urls.add(url)
                results.append(job)
    except Exception as e:
        print(f"[scraper] company careers scrape failed: {e}")

    return results


async def fetch_indeed_full_description(url: str) -> str | None:
    """Fetch the full job description from an Indeed job page."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=10),
                allow_redirects=True,
            ) as resp:
                if resp.status != 200:
                    return None
                html = await resp.text()

                patterns = [
                    r'id="jobDescriptionText"[^>]*>(.*?)</div>',
                    r'class="jobsearch-jobDescriptionText"[^>]*>(.*?)</div>',
                    r'"description"\s*:\s*"(.*?)"(?=,|\})',
                ]
                for pattern in patterns:
                    match = re.search(pattern, html, re.DOTALL | re.IGNORECASE)
                    if match:
                        text = match.group(1)
                        text = re.sub(r"<[^>]+>", " ", text)
                        text = re.sub(r"\s+", " ", text).strip()
                        text = (
                            text.replace("&amp;", "&")
                            .replace("&lt;", "<")
                            .replace("&gt;", ">")
                            .replace("&#39;", "'")
                            .replace("&quot;", '"')
                        )
                        if len(text) > 200:
                            return text
                return None
    except Exception as e:
        print(f"[indeed_desc] error fetching {url}: {e}")
        return None


async def enrich_short_descriptions(
    jobs: list[dict], threshold: int = 200
) -> list[dict]:
    """
    For Indeed jobs with very short descriptions, fetch the full text from
    the job URL. LinkedIn descriptions are handled by linkedin_fetcher.py.
    """
    to_enrich = [
        (i, job)
        for i, job in enumerate(jobs)
        if (
            len(job.get("description") or "") < threshold
            and "indeed" in (job.get("url") or "").lower()
            and job.get("url")
        )
    ]

    if not to_enrich:
        return jobs

    print(f"[enrich] {len(to_enrich)} Indeed jobs need full descriptions...")

    semaphore = asyncio.Semaphore(3)

    async def _fetch_one(i: int, job: dict) -> tuple[int, str | None]:
        async with semaphore:
            full = await fetch_indeed_full_description(job["url"])
            await asyncio.sleep(0.5)
            return i, full

    results = await asyncio.gather(*[_fetch_one(i, job) for i, job in to_enrich])

    enriched = 0
    for i, full_desc in results:
        if full_desc:
            old_len = len(jobs[i].get("description") or "")
            jobs[i]["description"] = full_desc
            print(f"[enrich] {jobs[i].get('title', '')[:40]}: {old_len} → {len(full_desc)} chars")
            enriched += 1

    print(f"[enrich] enriched {enriched}/{len(to_enrich)} Indeed jobs")
    return jobs


def _clean(value) -> str:
    import math
    if value is None:
        return ""
    try:
        if math.isnan(float(value)):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value).strip()


def _safe_int(value) -> int | None:
    try:
        return int(float(value)) if value is not None else None
    except (ValueError, TypeError):
        return None
