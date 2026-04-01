import asyncio
import httpx
from bs4 import BeautifulSoup

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://www.alljobs.co.il/",
}

SEARCH_TERMS = [
    "software engineer",
    "backend developer",
    "frontend developer",
    "full stack",
    "data engineer",
    "devops",
    "product manager",
    "QA",
]


async def scrape_alljobs() -> list[dict]:
    results: list[dict] = []
    seen_urls: set[str] = set()

    async with httpx.AsyncClient(headers=_HEADERS, timeout=20, follow_redirects=True) as client:
        for term in SEARCH_TERMS:
            try:
                jobs = await _fetch_term(client, term)
                for job in jobs:
                    url = job.get("url", "").strip()
                    if not url or url in seen_urls:
                        continue
                    seen_urls.add(url)
                    results.append(job)
            except Exception as e:
                print(f"[alljobs] error scraping '{term}': {e}")
            await asyncio.sleep(2)

    return results


async def _fetch_term(client: httpx.AsyncClient, term: str) -> list[dict]:
    # Alljobs search results page
    url = "https://www.alljobs.co.il/SearchResultsGuest.aspx"
    params = {
        "type": "4",
        "pos": "0",
        "s": "50",
        "q": term,
    }
    resp = await client.get(url, params=params)
    if resp.status_code != 200:
        return []
    return _parse_html(resp.text)


def _parse_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    jobs = []

    # Alljobs uses a list of job items; primary selectors based on their ASP.NET structure
    cards = (
        soup.select("div.job-content")
        or soup.select("div.single-job")
        or soup.select("[class*='job-box']")
        or soup.select("[id*='job']")
        or soup.select("li.job-item")
    )

    for card in cards:
        title_el = (
            card.select_one("h2 a, h3 a")
            or card.select_one("[class*='title'] a")
            or card.select_one("a[class*='title']")
            or card.select_one("a[href*='job']")
        )
        company_el = card.select_one(
            "[class*='company'], [class*='employer'], [class*='Company']"
        )
        location_el = card.select_one(
            "[class*='location'], [class*='city'], [class*='area']"
        )
        desc_el = card.select_one("[class*='desc'], [class*='summary'], p")

        title = title_el.get_text(strip=True) if title_el else ""
        href = title_el.get("href", "") if title_el else ""
        if href and not href.startswith("http"):
            href = "https://www.alljobs.co.il/" + href.lstrip("/")
        company = company_el.get_text(strip=True) if company_el else ""
        location = location_el.get_text(strip=True) if location_el else ""
        description = desc_el.get_text(strip=True) if desc_el else ""

        if not title or not href:
            continue

        jobs.append({
            "title": _clean(title),
            "company": _clean(company),
            "description": _clean(description),
            "location": _clean(location),
            "url": href.strip(),
            "source": "alljobs",
            "salary_min": None,
            "salary_max": None,
        })

    return jobs


def _clean(value) -> str:
    if not value:
        return ""
    return str(value).strip()
