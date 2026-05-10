import asyncio
import re

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

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
    "tlv",
    "remote - il",
    "תל אביב",
    "ישראל",
]


async def fetch_linkedin_jobs_for_term(
    search_term: str,
    browser_context,
) -> list[dict]:
    """Fetch LinkedIn jobs for a single search term in Israel using Playwright."""
    jobs = []
    page = await browser_context.new_page()

    try:
        for start in [0, 25, 50]:
            url = (
                "https://www.linkedin.com/jobs/search"
                f"?keywords={search_term.replace(' ', '%20')}"
                "&location=Israel"
                "&f_TPR=r86400"
                f"&start={start}"
            )

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=15000)
                await page.wait_for_timeout(2000)

                html = await page.content()
                soup = BeautifulSoup(html, "html.parser")

                job_cards = soup.find_all(
                    "div",
                    class_=re.compile(r"base-card|job-search-card"),
                )

                if not job_cards:
                    job_cards = soup.find_all(
                        "li",
                        class_=re.compile(r"jobs-search-results__list-item"),
                    )

                if not job_cards:
                    print(f"  No cards for '{search_term}' page {start // 25 + 1}")
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

                if len(job_cards) < 10:
                    break

                await page.wait_for_timeout(2000)

            except Exception as e:
                print(f"  Page error for '{search_term}': {e}")
                break

    finally:
        await page.close()

    return jobs


async def fetch_all_linkedin_jobs() -> list[dict]:
    """Fetch LinkedIn jobs using a shared Playwright browser across all search terms."""
    try:
        all_jobs: list[dict] = []
        seen_urls: set[str] = set()

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-blink-features=AutomationControlled",
                ],
            )

            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 800},
            )

            for term in LINKEDIN_SEARCH_TERMS:
                print(f"  LinkedIn: searching '{term}'...")
                jobs = await fetch_linkedin_jobs_for_term(term, context)

                for job in jobs:
                    url = job.get("url", "")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        all_jobs.append(job)

                print(f"  LinkedIn '{term}': {len(jobs)} jobs")
                await asyncio.sleep(3)

            await browser.close()

        print(f"LinkedIn total: {len(all_jobs)} unique jobs")
        return all_jobs

    except Exception as e:
        print(f"LinkedIn Playwright fetcher failed: {e}")
        print("Continuing without LinkedIn jobs...")
        return []
