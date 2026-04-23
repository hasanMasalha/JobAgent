import asyncio

from playwright.async_api import async_playwright

SEARCH_TERMS = [
    "software engineer",
    "backend developer",
    "frontend developer",
    "full stack",
    "data engineer",
    "devops",
    "product manager",
    "QA engineer",
]


async def scrape_drushim() -> list[dict]:
    results: list[dict] = []
    seen_urls: set[str] = set()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="he-IL",
        )

        for term in SEARCH_TERMS:
            try:
                jobs = await _scrape_term(context, term)
                for job in jobs:
                    url = job.get("url", "").strip()
                    if not url or url in seen_urls:
                        continue
                    seen_urls.add(url)
                    results.append(job)
            except Exception as e:
                print(f"[drushim] error scraping '{term}': {e}")
            await asyncio.sleep(2)

        await browser.close()

    return results


async def _scrape_term(context, term: str) -> list[dict]:
    captured: list[dict] = []

    page = await context.new_page()

    # Intercept Drushim's internal API calls to grab JSON directly
    async def handle_response(response):
        url = response.url
        if "jobs" in url and response.status == 200:
            try:
                ct = response.headers.get("content-type", "")
                if "json" in ct:
                    data = await response.json()
                    jobs = _extract_from_api(data)
                    captured.extend(jobs)
            except Exception:
                pass

    page.on("response", handle_response)

    try:
        search_url = f"https://www.drushim.co.il/jobs/search/?q={term.replace(' ', '+')}"
        await page.goto(search_url, wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(3000)

        # If we got jobs from API interception, return them
        if captured:
            return captured

        # Fallback: parse rendered DOM
        cards = await page.query_selector_all(".list-item-row, .job-item, [class*='job-card']")
        for card in cards:
            try:
                title_el = await card.query_selector("h2, h3, [class*='title']")
                company_el = await card.query_selector("[class*='company'], [class*='employer']")
                location_el = await card.query_selector("[class*='location'], [class*='city']")
                desc_el = await card.query_selector("[class*='desc'], [class*='summary'], p")
                link_el = await card.query_selector("a[href]")

                title = (await title_el.inner_text()).strip() if title_el else ""
                company = (await company_el.inner_text()).strip() if company_el else ""
                location = (await location_el.inner_text()).strip() if location_el else ""
                description = (await desc_el.inner_text()).strip() if desc_el else ""
                href = await link_el.get_attribute("href") if link_el else ""
                if href and not href.startswith("http"):
                    href = "https://www.drushim.co.il" + href

                if not title or not href:
                    continue

                captured.append({
                    "title": title,
                    "company": company,
                    "description": description,
                    "location": location,
                    "url": href.strip(),
                    "source": "drushim",
                    "salary_min": None,
                    "salary_max": None,
                })
            except Exception:
                continue
    finally:
        await page.close()

    return captured


def _extract_from_api(data) -> list[dict]:
    """Parse jobs from Drushim's JSON API response (various shapes)."""
    items = []
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = (
            data.get("jobs")
            or data.get("results")
            or data.get("data")
            or data.get("items")
            or []
        )
    if not isinstance(items, list):
        return []

    jobs = []
    for item in items:
        if not isinstance(item, dict):
            continue
        url = item.get("url") or item.get("jobUrl") or item.get("link") or ""
        if url and not url.startswith("http"):
            url = "https://www.drushim.co.il" + url
        title = item.get("title") or item.get("jobTitle") or item.get("name") or ""
        company = item.get("company") or item.get("companyName") or item.get("employer") or ""
        description = item.get("description") or item.get("jobDescription") or item.get("body") or ""
        location = item.get("location") or item.get("city") or item.get("area") or ""
        if not title or not url:
            continue
        jobs.append({
            "title": str(title).strip(),
            "company": str(company).strip(),
            "description": str(description).strip(),
            "location": str(location).strip(),
            "url": str(url).strip(),
            "source": "drushim",
            "salary_min": None,
            "salary_max": None,
        })
    return jobs
