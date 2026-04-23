import asyncio

from jobspy import scrape_jobs

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

    return results


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
