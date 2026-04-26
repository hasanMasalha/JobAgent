import asyncio
import csv
import html
import json
import re

import httpx

CSV_PATH = "companies.csv"

_NAME_ALIASES = ('Company', 'company name', 'Company Name')
_URL_ALIASES = ('Careers URL', 'Careers_URL', 'careers url', 'url', 'URL')

_ISRAELI_KEYWORDS = [
    "israel", "tel aviv", "תל אביב", "herzliya", "herzelia",
    "ramat gan", "petah tikva", "petach tikva", "haifa", "חיפה",
    "beer sheva", "be'er sheva", "rishon", "netanya", "rehovot",
    "jerusalem", "ירושלים", "tlv", "natanya", "kfar saba",
    "ra'anana", "raanana", "hod hasharon", "modiin", "ashdod",
    "tel-aviv", "telaviv", "herzeliya", "yavne", "yokneam", "caesarea",
]


def is_israeli_job(job: dict) -> bool:
    location = (job.get('location') or '').lower().strip()
    url = (job.get('url') or '').lower().strip()

    if location:
        # Location is explicit — check it regardless of company flag
        return any(kw in location for kw in _ISRAELI_KEYWORDS)

    # Empty location: trust companies we knowingly added to the CSV
    if job.get('known_israeli_company'):
        return True

    # Unknown company, empty location — check URL for Israeli signals
    if ".co.il" in url or "/il/" in url:
        return True

    return False


def _normalize_row(row: dict) -> dict:
    """Resolve column name aliases to the standard keys used everywhere."""
    if not row.get('name'):
        for alias in _NAME_ALIASES:
            if row.get(alias):
                row['name'] = row.pop(alias)
                break
    if not row.get('careers_url'):
        for alias in _URL_ALIASES:
            if row.get(alias):
                row['careers_url'] = row.pop(alias)
                break
    return row


def load_companies() -> list[dict]:
    """Load active companies from CSV"""
    try:
        with open(CSV_PATH, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            rows = [_normalize_row(dict(row)) for row in reader]
            return [
                row for row in rows
                if row.get('active', 'true').lower() == 'true'
                and row.get('careers_url', '')
            ]
    except FileNotFoundError:
        print("companies.csv not found — run discovery first")
        return []


async def scrape_greenhouse(company: dict) -> list[dict]:
    slug = company['slug']
    if not slug:
        return []

    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(url)
            if resp.status_code != 200:
                return []

            jobs = []
            for job in resp.json().get('jobs', []):
                location = ""
                if job.get('location'):
                    location = job['location'].get('name', '')

                raw_content = html.unescape(job.get('content', ''))
                description = re.sub(r'<[^>]+>', ' ', raw_content)
                description = re.sub(r'\s+', ' ', description).strip()[:3000]

                jobs.append({
                    'title': job.get('title', ''),
                    'company': company['name'],
                    'description': description,
                    'location': location,
                    'url': job.get('absolute_url', ''),
                    'source': 'company_careers',
                    'salary_min': None,
                    'salary_max': None,
                })
            return jobs
        except Exception as e:
            print(f"Greenhouse error for {company['name']}: {e}")
            return []


async def scrape_lever(company: dict) -> list[dict]:
    slug = company['slug']
    if not slug:
        return []

    url = f"https://api.lever.co/v0/postings/{slug}?mode=json"
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, timeout=10)
            if resp.status_code != 200:
                return []

            jobs = []
            for posting in resp.json():
                description = posting.get('descriptionPlain', '')[:3000]

                jobs.append({
                    'title': posting.get('text', ''),
                    'company': company['name'],
                    'description': description,
                    'location': posting.get(
                        'categories', {}
                    ).get('location', ''),
                    'url': posting.get('hostedUrl', ''),
                    'source': 'company_careers',
                    'salary_min': None,
                    'salary_max': None,
                })
            return jobs
        except Exception as e:
            print(f"Lever error for {company['name']}: {e}")
            return []


async def scrape_comeet(company: dict) -> list[dict]:
    slug = company.get('slug', '')
    if not slug or ':' not in slug:
        return []
    uid, token = slug.split(':', 1)
    url = f'https://www.comeet.co/careers-api/2.0/company/{uid}/positions?token={token}'
    async with httpx.AsyncClient(follow_redirects=True) as client:
        try:
            resp = await client.get(url, timeout=10)
            if resp.status_code != 200:
                return []
            jobs = []
            for pos in resp.json():
                loc = pos.get('location') or {}
                location = loc.get('name') or loc.get('city') or ''
                job_url = pos.get('url_active_page') or pos.get('url_comeet_hosted_page', '')
                jobs.append({
                    'title': pos.get('name', ''),
                    'company': company['name'],
                    'description': '',
                    'location': location,
                    'url': job_url,
                    'source': 'company_careers',
                    'salary_min': None,
                    'salary_max': None,
                })
            return jobs
        except Exception as e:
            print(f"Comeet error for {company['name']}: {e}")
            return []


async def scrape_html_page(company: dict) -> list[dict]:
    """
    For companies with plain HTML careers pages,
    use Claude to extract job listings.
    """
    import os

    from anthropic import Anthropic
    from bs4 import BeautifulSoup

    client_http = httpx.AsyncClient(follow_redirects=True)
    anthropic_client = Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])

    try:
        resp = await client_http.get(
            company['careers_url'], timeout=15
        )
        soup = BeautifulSoup(resp.text, 'html.parser')

        for tag in soup(['script', 'style', 'nav',
                         'footer', 'header']):
            tag.decompose()

        clean_text = '\n'.join(
            line.strip()
            for line in soup.get_text(separator='\n').split('\n')
            if len(line.strip()) > 15
        )[:4000]

        if not clean_text:
            return []

        response = anthropic_client.messages.create(
            model="claude-haiku-3-5",
            max_tokens=1500,
            messages=[{
                "role": "user",
                "content": f"""Extract job listings from this page.
Return ONLY a JSON array:
[{{"title":"...","location":"...","url":"..."}}]
Return [] if no jobs found.

Company: {company['name']}
URL: {company['careers_url']}

Content:
{clean_text}"""
            }]
        )

        jobs_data = json.loads(response.content[0].text)
        return [
            {
                'title': j.get('title', ''),
                'company': company['name'],
                'description': '',
                'location': j.get('location', ''),
                'url': j.get('url', company['careers_url']),
                'source': 'company_careers',
                'salary_min': None,
                'salary_max': None,
            }
            for j in jobs_data if j.get('title')
        ]

    except Exception as e:
        print(f"HTML scrape error for {company['name']}: {e}")
        return []
    finally:
        await client_http.aclose()


async def fetch_job_description(url: str, client: httpx.AsyncClient) -> str:
    if not url or not url.startswith('http'):
        return ""
    try:
        resp = await client.get(url, timeout=15)
        if resp.status_code != 200:
            print(f"  DESC FETCH: {resp.status_code} for {url[:60]}")
            return ""

        from bs4 import BeautifulSoup

        soup = BeautifulSoup(resp.text, 'html.parser')

        # JSON-LD first — parse before stripping any tags
        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = json.loads(script.string or '{}')
                items = data.get('@graph', [data]) if isinstance(data, dict) else [data]
                for item in items:
                    if item.get('@type') == 'JobPosting':
                        desc = item.get('description', '')
                        if desc:
                            clean = re.sub(r'<[^>]+>', ' ', desc)
                            clean = re.sub(r'\s+', ' ', clean).strip()
                            if len(clean) > 100:
                                print(f"  DESC OK (JSON-LD): {url[:50]}")
                                return clean[:3000]
            except Exception:
                continue

        # Strip noise elements before CSS/text extraction
        for tag in soup.find_all(['nav', 'header', 'footer', 'script', 'style']):
            tag.decompose()
        for selector in [
            '[class*="nav"]', '[class*="header"]', '[class*="footer"]',
            '[class*="menu"]', '[class*="cookie"]', '[class*="banner"]',
            '[id*="nav"]', '[id*="header"]', '[id*="footer"]',
        ]:
            for tag in soup.select(selector):
                tag.decompose()

        _NAV_SIGNALS = ('log in', 'contact sales', 'get started', 'sign up', 'pricing')

        for selector in [
            '.job-description', '#job-description',
            '[class*="job-description"]', '[class*="jobDescription"]',
            '[class*="position-description"]', '[class*="job-details"]',
            '[class*="job_description"]', '[data-ui="job-description"]',
            '.description', '.posting-requirements',
            'article', '[role="main"]', 'main',
        ]:
            el = soup.select_one(selector)
            if el:
                text = el.get_text(separator=' ', strip=True)
                preview = text[:100].lower()
                if len(text) > 300 and not any(s in preview for s in _NAV_SIGNALS):
                    print(f"  DESC OK ({selector}): {url[:50]}")
                    return text[:3000]

        paragraphs = soup.find_all('p')
        job_paragraphs = [
            p.get_text(strip=True) for p in paragraphs
            if (len(p.get_text(strip=True)) > 80
                and 'cookie' not in p.get_text().lower()
                and 'privacy' not in p.get_text().lower()[:50])
        ]
        text = ' '.join(job_paragraphs)
        if len(text) > 300:
            print(f"  DESC OK (paragraphs): {url[:50]}")
            return text[:3000]

        print(f"  DESC FAILED (no content found): {url[:60]}")
        return ""
    except Exception as e:
        print(f"  DESC ERROR: {e} for {url[:60]}")
        return ""


async def enrich_empty_descriptions(jobs: list[dict], max_concurrent: int = 5) -> list[dict]:
    empty = [(i, j) for i, j in enumerate(jobs)
             if not j.get('description') or len(j.get('description', '')) < 100]
    if not empty:
        return jobs

    print(f"Fetching descriptions for {len(empty)} jobs with empty descriptions...")
    sem = asyncio.Semaphore(max_concurrent)

    async with httpx.AsyncClient(
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                               "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"},
        timeout=15,
    ) as client:
        async def fetch_one(idx: int, job: dict) -> None:
            async with sem:
                desc = await fetch_job_description(job.get('url', ''), client)
                if desc:
                    jobs[idx]['description'] = desc
                await asyncio.sleep(0.3)

        await asyncio.gather(*[fetch_one(i, j) for i, j in empty], return_exceptions=True)

    filled = sum(1 for i, _ in empty if len(jobs[i].get('description', '')) > 100)
    print(f"Description enrichment: {filled}/{len(empty)} jobs filled")
    return jobs


async def scrape_company(company: dict) -> list[dict]:
    """Route to correct scraper based on ATS type"""
    ats = company.get('ats_type', 'unknown')

    _handlers = {
        'greenhouse': scrape_greenhouse,
        'lever': scrape_lever,
        'comeet': scrape_comeet,
    }

    if ats == 'html':
        from playwright_scraper import scrape_jobs_with_playwright
        handler = scrape_jobs_with_playwright
    else:
        handler = _handlers.get(ats)

    if not handler:
        return []  # workday, unknown etc — skip for now

    jobs = await handler(company)
    for job in jobs:
        job['known_israeli_company'] = True
    return jobs


async def scrape_all_company_careers() -> list[dict]:
    """
    Main function — called by daily scheduler.
    Reads CSV and scrapes all active companies.
    """
    companies = load_companies()
    if not companies:
        return []

    print(f"Scraping {len(companies)} companies from CSV...")
    all_jobs = []

    _DEBUG_COMPANIES = {'Payoneer', 'Wix', 'Fiverr', 'eToro'}
    for company in companies:
        try:
            jobs = await scrape_company(company)
            if company['name'] in _DEBUG_COMPANIES:
                locations = set(j.get('location', '') for j in jobs)
                print(f"DEBUG {company['name']}: {len(jobs)} jobs, locations: {locations}")
            if jobs:
                print(f"  {company['name']}: {len(jobs)} jobs")
                all_jobs.extend(jobs)
        except Exception as e:
            print(f"  {company['name']}: failed — {e}")

        await asyncio.sleep(1)

    all_jobs_raw = all_jobs
    all_jobs = [j for j in all_jobs if is_israeli_job(j)]
    print(f"Israel filter: {len(all_jobs_raw)} → {len(all_jobs)} jobs")

    all_jobs = await enrich_empty_descriptions(all_jobs)

    print(f"Company scrape complete: {len(all_jobs)} total jobs")
    return all_jobs
