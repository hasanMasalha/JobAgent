import asyncio
import csv
import html
import json
import re

import httpx
from bs4 import BeautifulSoup

CSV_PATH = "companies.csv"


def _html_to_text(text: str) -> str:
    """Convert HTML to structured plain text preserving bullets and sections."""
    if not text:
        return ""
    soup = BeautifulSoup(text, "html.parser")
    for li in soup.find_all("li"):
        li.insert_before("\n• ")
    for tag in soup.find_all(["p", "div", "h1", "h2", "h3", "h4", "br"]):
        tag.append("\n")
    result = soup.get_text(separator="\n")
    return re.sub(r"\n{3,}", "\n\n", result).strip()

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


_BAD_JOB_URL_FRAGMENTS = (
    'facebook.com/shar', 'whatsapp.com/send', 'api.whatsapp.com',
    'linkedin.com/shar', 'twitter.com/share', 'share_job_id',
    '/solutions/', '/solution/', '/services/', '/service/',
    '/support', '/contact', '/product/', '/products/',
    '/blog/', '/news/', '/about/', '/privacy', '/terms', '/cookies',
    '/learn/', '/resources/', '/partners/', '/pricing/', '/platform/',
    '/technology/',
)

_BAD_JOB_TITLE_FRAGMENTS = (
    # Navigation / auth actions
    'sign in', 'log in', 'support center', 'contact sales',
    'privacy policy', 'cookie policy', 'terms of service', 'terms of use',
    'learn more', 'get started', 'sign up', 'register', 'free trial',
    'whatsapp', 'share on', 'follow us', 'contact us', 'read more',
    'view all', 'linkedin corporation', '<img',
    # Company org / marketing pages
    'board of directors', 'leadership team', 'product warranty',
    'maintenance and support', 'voip technology products',
    'device manager', 'routing manager', 'survivability products',
    'developer platform', 'token manager', 'data api',
    'international exchange api', 'product groups',
    'industry leading security', 'wealth managers', 'asset managers',
    'managed tech', 'data centers & networks',
    # Security marketing pages (ceragon, allot etc.)
    '5g security', '5g network security', 'network-native security',
    'connected home security', 'converged security',
    'service provider security', 'network security for business',
    'sp security', 'siklu by ceragon',
    # Support / feedback pages
    'product feedback', 'historical market data',
    'secure internal communication', 'get support help',
    'product/solution info', '24/7 support', '24/7 chat support',
)

_JOB_TITLE_WORDS = (
    'engineer', 'developer', 'manager', 'analyst',
    'designer', 'scientist', 'architect', 'director',
    'lead', 'senior', 'junior', 'intern', 'specialist',
    'consultant', 'researcher', 'devops', 'qa', 'sre',
    'fullstack', 'full stack', 'backend', 'frontend',
    'product', 'data', 'cloud', 'security', 'software',
    'hardware', 'sales', 'marketing', 'recruiter', 'hr',
    'finance', 'legal', 'operations', 'support',
    # Hebrew
    'מהנד', 'מפתח', 'מנהל', 'אנליסט', 'מעצב',
    'חוקר', 'מומחה', 'בכיר', 'מתמחה', 'ראש',
)

_NON_JOB_URL_PATHS = (
    '/blog/', '/news/', '/docs/', '/api/',
    '/support', '/product', '/solution',
    '/about', '/contact',
    '/pricing', '/legal', '/privacy',
    '/terms', '/resources', '/learn/',
    '/platform/', '/technology/', '/features/',
    '/partners/', '/customers/', '/events/',
    '/webinar', '/whitepaper', '/ebook',
    'facebook.com', 'twitter.com', 'linkedin.com/shar',
    'whatsapp', 'mailto:', 'javascript:',
    '/engineering-blog', '/developer-blog',
    '/trust/', '/compliance/', '/certification/',
    '/leadership', '/board', '/team/',
    '/press/', '/media/', '/investor',
    '/search?', '/department?', '/filter?',
)

_VALID_CAREERS_PATTERNS = (
    '/careers', '/jobs', '/positions',
    '/vacancies', '/join', '/work-with-us',
    '/joinus', 'greenhouse.io', 'lever.co',
    'comeet.com', 'ashbyhq.com', 'workable.com',
)


def looks_like_job_title(title: str) -> bool:
    if not title or len(title) < 3 or len(title) > 150:
        return False
    t = title.lower()
    if t.startswith('<') or '</' in t:
        return False
    if t.startswith('http') or '://' in t:
        return False
    if any(c in title for c in ('©', '®', '™', '↓')):
        return False
    return any(word in t for word in _JOB_TITLE_WORDS)


def looks_like_job_url(url: str) -> bool:
    if not url:
        return False
    u = url.lower()
    return not any(p in u for p in _NON_JOB_URL_PATHS)


def is_valid_careers_url(url: str) -> bool:
    u = url.lower()
    return any(p in u for p in _VALID_CAREERS_PATTERNS)


def is_valid_job(job: dict) -> bool:
    """Filter out non-job pages scraped by mistake."""
    url = (job.get('url') or '').lower()
    title = (job.get('title') or '').strip()
    title_lower = title.lower()

    if not looks_like_job_title(title):
        return False
    if not looks_like_job_url(url):
        return False
    if any(bad in url for bad in _BAD_JOB_URL_FRAGMENTS):
        return False
    if any(bad in title_lower for bad in _BAD_JOB_TITLE_FRAGMENTS):
        return False
    return True


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
                description = _html_to_text(raw_content)[:3000]

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
            model="claude-haiku-4-5-20251001",
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
                            clean = _html_to_text(desc)
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
                text = _html_to_text(str(el))
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
        text = "\n\n".join(job_paragraphs)
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
    name = company.get('name', '?')
    ats = company.get('ats_type', 'unknown')
    careers_url = company.get('careers_url', '')

    _handlers = {
        'greenhouse': scrape_greenhouse,
        'lever': scrape_lever,
        'comeet': scrape_comeet,
    }

    if ats in ('html', 'ashby'):
        if not is_valid_careers_url(careers_url):
            print(f"[SKIP] {name}: careers URL doesn't look like a jobs page: {careers_url}")
            return []
        from playwright_scraper import scrape_jobs_with_playwright
        handler = scrape_jobs_with_playwright
    else:
        handler = _handlers.get(ats)

    if not handler:
        return []  # workday, unknown etc — skip for now

    jobs = await handler(company)
    raw_count = len(jobs)
    jobs = [j for j in jobs if is_valid_job(j)]
    filtered_count = raw_count - len(jobs)
    if filtered_count:
        print(f"  {name}: filtered {filtered_count} garbage jobs")

    # Health check: warn if scraper is returning mostly garbage
    if raw_count > 0:
        filter_rate = filtered_count / raw_count
        if filter_rate > 0.8 and raw_count > 10:
            print(f"[WARNING] {name}: {filter_rate:.0%} of jobs filtered — careers page may be broken")
        if len(jobs) == 0 and raw_count > 0:
            print(f"[WARNING] {name}: ALL {raw_count} scraped pages were garbage — check careers URL")

    # For all html/ashby companies, drop any job with an explicit non-Israeli
    # location. Empty location passes through — many Israeli-office jobs don't
    # populate location in scraped HTML.
    if ats in ('html', 'ashby'):
        before_loc = len(jobs)
        jobs = [
            j for j in jobs
            if not (j.get('location') or '')
            or any(kw in (j.get('location') or '').lower() for kw in _ISRAELI_KEYWORDS)
        ]
        if len(jobs) < before_loc:
            print(f"  {name}: location filter removed {before_loc - len(jobs)} non-Israeli jobs")

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
    print(f"Israel filter: {len(all_jobs_raw)} -> {len(all_jobs)} jobs")

    all_jobs = await enrich_empty_descriptions(all_jobs)

    print(f"Company scrape complete: {len(all_jobs)} total jobs")
    return all_jobs
