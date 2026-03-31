import asyncio
from jobspy import scrape_jobs

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
                site_name=["indeed", "linkedin"],
                search_term=term,
                location="Israel",
                country_indeed="Israel",
                results_wanted=30,
                hours_old=48,
            )
        except Exception as e:
            print(f"[scraper] error scraping '{term}': {e}")
            await asyncio.sleep(2)
            continue

        for _, row in df.iterrows():
            url = str(row.get("job_url") or "").strip()
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)

            salary_min = _safe_int(row.get("min_amount"))
            salary_max = _safe_int(row.get("max_amount"))

            results.append(
                {
                    "title": _clean(row.get("title")),
                    "company": _clean(row.get("company")),
                    "description": _clean(row.get("description")),
                    "location": _clean(row.get("location")),
                    "url": url,
                    "source": _clean(row.get("site")),
                    "salary_min": salary_min,
                    "salary_max": salary_max,
                }
            )

        await asyncio.sleep(2)

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
