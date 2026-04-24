import asyncio
import csv
import json
import os
import re
from datetime import datetime

import httpx
from bs4 import BeautifulSoup

CSV_PATH = "companies.csv"

_HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        " AppleWebKit/537.36 Chrome/120.0.0.0"
    )
}


async def discover_from_greenhouse() -> list[dict]:
    """
    Search Greenhouse for jobs in Israel and extract unique company slugs.
    """
    companies_found = []
    seen_slugs: set[str] = set()

    search_terms = [
        "Tel Aviv", "Herzliya", "Ramat Gan", "Petah Tikva",
        "Haifa", "Beer Sheva", "Netanya", "Israel", "תל אביב",
    ]

    async with httpx.AsyncClient(timeout=15) as client:
        for term in search_terms:
            try:
                resp = await client.get(
                    "https://api.greenhouse.io/v1/boards",
                    params={"location": term, "per_page": 100},
                )

                if resp.status_code == 200:
                    data = resp.json()
                    for job in data.get("jobs", []):
                        url = job.get("absolute_url", "")
                        match = re.search(
                            r'greenhouse\.io/([^/]+)/jobs', url
                        )
                        if match:
                            slug = match.group(1)
                            if slug not in seen_slugs:
                                seen_slugs.add(slug)
                                companies_found.append({
                                    "slug": slug,
                                    "company": job.get(
                                        "company", {}
                                    ).get("name", slug),
                                    "location": job.get(
                                        "location", {}
                                    ).get("name", ""),
                                })

                await asyncio.sleep(1)
            except Exception as e:
                print(f"Greenhouse search error for {term}: {e}")

    return companies_found


async def discover_via_serper_search(
    client: httpx.AsyncClient,
) -> list[dict]:
    """
    Use Serper API to find Israeli companies on Greenhouse and Lever.
    Returns Google search results as structured JSON — no scraping,
    no CAPTCHA.
    """
    api_key = os.environ.get('SERPER_API_KEY', '')
    if not api_key:
        print("SERPER_API_KEY not set — skipping")
        return []

    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }

    queries = [
        'site:boards.greenhouse.io "Tel Aviv"',
        'site:boards.greenhouse.io "Israel"',
        'site:boards.greenhouse.io "Herzliya"',
        'site:boards.greenhouse.io "Ramat Gan"',
        'site:boards.greenhouse.io "Petah Tikva"',
        'site:jobs.lever.co "Tel Aviv"',
        'site:jobs.lever.co "Israel"',
        'site:jobs.lever.co "Herzliya"',
    ]

    greenhouse_slugs: set[str] = set()
    lever_slugs: set[str] = set()

    for query in queries:
        try:
            resp = await client.post(
                "https://google.serper.dev/search",
                headers=headers,
                content=json.dumps({
                    "q": query,
                    "num": 100,
                    "gl": "il",
                    "hl": "en",
                }),
                timeout=15,
            )

            if resp.status_code == 429:
                print("Serper rate limited — waiting 10s...")
                await asyncio.sleep(10)
                continue

            if resp.status_code != 200:
                print(f"Serper API error: {resp.status_code}")
                continue

            data = resp.json()

            for result in data.get("organic", []):
                url = result.get("link", "")

                gh_match = re.search(
                    r'boards\.greenhouse\.io/([a-zA-Z0-9_-]+)', url
                )
                if gh_match:
                    slug = gh_match.group(1)
                    if slug not in ('embed', 'api', 'v1', 'jobs'):
                        greenhouse_slugs.add(slug)

                lv_match = re.search(
                    r'jobs\.lever\.co/([a-zA-Z0-9_-]+)', url
                )
                if lv_match:
                    slug = lv_match.group(1)
                    if slug not in ('api', 'v0'):
                        lever_slugs.add(slug)

            print(
                f"  '{query[:45]}...': "
                f"{len(data.get('organic', []))} results"
            )

            await asyncio.sleep(0.5)

        except Exception as e:
            print(f"Serper error for '{query}': {e}")

    companies = []
    for slug in greenhouse_slugs:
        companies.append({
            "slug": slug,
            "ats_type": "greenhouse",
            "careers_url": f"https://boards.greenhouse.io/{slug}",
        })
    for slug in lever_slugs:
        companies.append({
            "slug": slug,
            "ats_type": "lever",
            "careers_url": f"https://jobs.lever.co/{slug}",
        })

    print(
        f"Serper found: {len(greenhouse_slugs)} Greenhouse "
        f"+ {len(lever_slugs)} Lever companies"
    )
    return companies


async def discover_from_startup_nation(
    client: httpx.AsyncClient,
) -> list[dict]:
    """
    Scrape Start-Up Nation Central for Israeli tech companies.
    Returns list of {name, website} dicts.
    """
    companies = []

    for page in range(1, 20):
        url = (
            f"https://finder.startupnationcentral.org/"
            f"companies?page={page}&country=Israel&industry=Software"
        )

        try:
            resp = await client.get(url, timeout=15)
            soup = BeautifulSoup(resp.text, 'html.parser')

            company_cards = soup.select(
                '.company-card, .company-item, [class*="company"]'
            )

            for card in company_cards:
                name_el = card.select_one('h2, h3, .company-name')
                website_el = card.select_one('a[href*="http"]')

                if name_el and website_el:
                    companies.append({
                        "name": name_el.get_text(strip=True),
                        "website": website_el.get('href', ''),
                    })

            if not company_cards:
                break

            await asyncio.sleep(2)

        except Exception as e:
            print(f"StartupNation page {page} error: {e}")
            break

    return companies


async def auto_discover_israeli_companies() -> dict:
    """
    Run all discovery strategies and add new companies to CSV.
    Skips companies already in the CSV by slug.
    """
    existing_slugs: set[str] = set()
    existing_names: set[str] = set()
    existing_rows: list[dict] = []
    fieldnames: list[str] = [
        'name', 'careers_url', 'ats_type',
        'slug', 'last_crawled', 'active',
    ]

    try:
        with open(CSV_PATH, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            existing_rows = list(reader)
            if reader.fieldnames:
                fieldnames = list(reader.fieldnames)
            for row in existing_rows:
                existing_slugs.add(row.get('slug', ''))
                existing_names.add(row.get('name', '').lower())
    except FileNotFoundError:
        pass

    new_companies = []

    async with httpx.AsyncClient(
        follow_redirects=True,
        headers=_HTTP_HEADERS,
    ) as client:
        print("Strategy 1: Searching via Serper for Israeli ATS boards...")
        ats_results = await discover_via_serper_search(client)

        for company in ats_results:
            slug = company.get('slug', '')
            if slug and slug not in existing_slugs:
                existing_slugs.add(slug)
                new_companies.append({
                    'name': slug,
                    'careers_url': company['careers_url'],
                    'ats_type': company['ats_type'],
                    'slug': slug,
                    'last_crawled': datetime.now().strftime('%Y-%m-%d'),
                    'active': 'true',
                })

        print(f"  Found {len(new_companies)} new ATS companies")

    if new_companies:
        all_rows = existing_rows + new_companies
        with open(CSV_PATH, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(all_rows)

    total = len(existing_rows) + len(new_companies)
    print(f"Added {len(new_companies)} new companies to CSV")
    return {
        "new_companies_found": len(new_companies),
        "total_in_csv": total,
    }
