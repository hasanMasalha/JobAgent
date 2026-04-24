import asyncio
import csv
import json

import httpx

CSV_PATH = "companies.csv"

_NAME_ALIASES = ('Company', 'company name', 'Company Name')
_URL_ALIASES = ('Careers URL', 'Careers_URL', 'careers url', 'url', 'URL')


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

    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, timeout=10)
            if resp.status_code != 200:
                return []

            jobs = []
            for job in resp.json().get('jobs', []):
                location = ""
                if job.get('location'):
                    location = job['location'].get('name', '')

                jobs.append({
                    'title': job.get('title', ''),
                    'company': company['name'],
                    'description': '',
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
                description = ' '.join([
                    section.get('text', '') + ': ' +
                    ' '.join(section.get('content', []))
                    for section in posting.get('lists', [])
                ])

                jobs.append({
                    'title': posting.get('text', ''),
                    'company': company['name'],
                    'description': description[:2000],
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


async def scrape_company(company: dict) -> list[dict]:
    """Route to correct scraper based on ATS type"""
    ats = company.get('ats_type', 'unknown')

    if ats == 'greenhouse':
        return await scrape_greenhouse(company)
    elif ats == 'lever':
        return await scrape_lever(company)
    elif ats == 'html':
        return await scrape_html_page(company)
    else:
        # workday, unknown etc — skip for now
        return []


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

    for company in companies:
        try:
            jobs = await scrape_company(company)
            if jobs:
                print(f"  {company['name']}: {len(jobs)} jobs")
                all_jobs.extend(jobs)
        except Exception as e:
            print(f"  {company['name']}: failed — {e}")

        await asyncio.sleep(1)

    print(f"Company scrape complete: {len(all_jobs)} total jobs")
    return all_jobs
