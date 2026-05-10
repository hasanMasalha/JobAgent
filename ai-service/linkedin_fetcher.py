import asyncio
import re

import httpx
from bs4 import BeautifulSoup

LINKEDIN_SEARCH_TERMS = [
    "software engineer",
    "backend developer",
    "frontend developer",
    "full stack developer",
    "data engineer",
    "devops engineer",
    "data scientist",
    "product manager",
    "QA engineer",
    "mobile developer",
    "machine learning engineer",
    "cybersecurity engineer",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;"
    "q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.linkedin.com/",
}

_ISRAELI_KEYWORDS = [
    "israel",
    "tel aviv",
    "herzliya",
    "ramat gan",
    "haifa",
    "jerusalem",
    "netanya",
    "petah tikva",
    "rehovot",
    "rishon",
    "beer sheva",
    "remote - il",
    "תל אביב",
    "ישראל",
]


async def fetch_linkedin_jobs_for_term(
    search_term: str,
    client: httpx.AsyncClient,
) -> list[dict]:
    """Fetch LinkedIn jobs for a single search term in Israel."""
    jobs = []

    for start in [0, 25, 50]:
        url = (
            "https://www.linkedin.com/jobs/search"
            f"?keywords={search_term.replace(' ', '%20')}"
            "&location=Israel"
            "&f_TPR=r86400"
            f"&start={start}"
            "&position=1"
            "&pageNum=0"
        )

        try:
            resp = await client.get(url, timeout=15)

            if resp.status_code == 429:
                print(f"  LinkedIn rate limited for '{search_term}'")
                break

            if resp.status_code != 200:
                print(f"  LinkedIn returned {resp.status_code} for '{search_term}'")
                break

            soup = BeautifulSoup(resp.text, "html.parser")

            job_cards = soup.find_all(
                "div",
                class_=re.compile(r"base-card|job-search-card|jobs-search__results-list"),
            )

            if not job_cards:
                job_cards = soup.find_all(
                    "li",
                    class_=re.compile(r"jobs-search-results__list-item"),
                )

            if not job_cards:
                print(f"  No job cards found for '{search_term}' page {start // 25 + 1}")
                break

            for card in job_cards:
                try:
                    title_el = card.find(
                        ["h3", "h4"],
                        class_=re.compile(r"title|job-title"),
                    )
                    title = title_el.get_text(strip=True) if title_el else ""

                    company_el = card.find(class_=re.compile(r"company|subtitle"))
                    company = company_el.get_text(strip=True) if company_el else ""

                    location_el = card.find(class_=re.compile(r"location|metadata"))
                    location = location_el.get_text(strip=True) if location_el else ""

                    link_el = card.find("a", href=True)
                    job_url = ""
                    if link_el:
                        href = link_el["href"]
                        job_url = href.split("?")[0] if "?" in href else href
                        if not job_url.startswith("http"):
                            job_url = "https://www.linkedin.com" + job_url

                    if not title or not job_url:
                        continue

                    location_lower = location.lower()
                    if location and not any(kw in location_lower for kw in _ISRAELI_KEYWORDS):
                        continue

                    jobs.append(
                        {
                            "title": title,
                            "company": company,
                            "description": "",
                            "location": location,
                            "url": job_url,
                            "source": "linkedin",
                            "salary_min": None,
                            "salary_max": None,
                        }
                    )

                except Exception:
                    continue

            await asyncio.sleep(2)

            if len(job_cards) < 10:
                break

        except Exception as e:
            print(f"  LinkedIn fetch error for '{search_term}': {e}")
            break

    return jobs


async def fetch_all_linkedin_jobs() -> list[dict]:
    """Fetch LinkedIn jobs for all search terms, deduplicated by URL."""
    try:
        all_jobs: list[dict] = []
        seen_urls: set[str] = set()

        async with httpx.AsyncClient(
            headers=HEADERS,
            follow_redirects=True,
            timeout=15,
        ) as client:
            for term in LINKEDIN_SEARCH_TERMS:
                print(f"  LinkedIn: searching '{term}'...")
                jobs = await fetch_linkedin_jobs_for_term(term, client)

                for job in jobs:
                    url = job.get("url", "")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        all_jobs.append(job)

                print(f"  LinkedIn '{term}': {len(jobs)} jobs found")
                await asyncio.sleep(3)

        print(f"LinkedIn feed total: {len(all_jobs)} unique jobs")
        return all_jobs

    except Exception as e:
        print(f"LinkedIn feed fetcher failed: {e}")
        print("Continuing without LinkedIn jobs...")
        return []
