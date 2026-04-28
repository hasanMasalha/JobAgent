import json
import re

from playwright.async_api import Browser, Page, async_playwright

_SKIP_SLUGS = frozenset({'embed', 'api', 'v1', 'jobs', 'careers', 'apply'})

# (url_pattern, ats_name, slug_group)
# slug_group = int → m.group(int)
# slug_group = None → no slug
# slug_group = "comeet" → special two-group encoding
_REQUEST_PATTERNS = [
    (r'boards-api\.greenhouse\.io/v1/boards/([a-zA-Z0-9_-]+)', 'greenhouse', 1),
    (r'job-boards\.greenhouse\.io/([a-zA-Z0-9_-]+)', 'greenhouse', 1),
    (r'api\.lever\.co/v0/postings/([a-zA-Z0-9_-]+)', 'lever', 1),
    (r'api\.ashbyhq\.com/posting-public/job', 'ashby', None),
    (r'jobs\.ashbyhq\.com/([a-zA-Z0-9_-]+)', 'ashby', 1),
    (r'app\.ashbyhq\.com/api/non-user-graphql', 'ashby', None),
    (r'([a-zA-Z0-9-]+)\.wd\d+\.myworkdayjobs\.com', 'workday', 1),
    (r'careers-api/2\.0/company/([A-Z0-9.]+)/positions\?token=([A-Za-z0-9]+)', 'comeet', 'comeet'),
    (r'api\.smartrecruiters\.com/v1/companies/([A-Za-z0-9]+)/postings', 'smartrecruiters', 1),
    (r'([a-zA-Z0-9-]+)\.icims\.com/jobs', 'icims', 1),
    (r'apply\.workable\.com/([a-zA-Z0-9_-]+)', 'workable', 1),
]

# Domains that use Kasada bot-detection, which blocks headless Chromium
_KASADA_DOMAINS = ('myworkdayjobs.com', 'icims.com')

_UA = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/120.0.0.0 Safari/537.36'
)


def _parse_request_url(url: str) -> dict | None:
    for pattern, ats_name, group_spec in _REQUEST_PATTERNS:
        m = re.search(pattern, url, re.IGNORECASE)
        if not m:
            continue
        if group_spec == 'comeet':
            return {'ats_type': 'comeet', 'slug': f'{m.group(1)}:{m.group(2)}'}
        if group_spec is None:
            return {'ats_type': ats_name, 'slug': ''}
        slug = m.group(group_spec)
        if slug in _SKIP_SLUGS:
            continue
        return {'ats_type': ats_name, 'slug': slug}
    return None


def _is_kasada_domain(url: str) -> bool:
    return any(d in url for d in _KASADA_DOMAINS)


async def _is_kasada_blocked(page: Page, got_403: bool) -> bool:
    """Return True if Kasada served a bot-detection challenge."""
    if got_403:
        return True
    # Kasada redirects to a /pxt/ challenge path
    if '/pxt/' in page.url:
        return True
    try:
        content = await page.content()
        return 'kasada' in content.lower()
    except Exception:
        return False


async def _detect_with_chrome(name: str, careers_url: str) -> dict:
    """Retry ATS detection using the installed system Chrome (bypasses Kasada)."""
    detected: dict = {}
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, channel='chrome')
            try:
                page = await browser.new_page(user_agent=_UA)

                def on_request(request):
                    if detected:
                        return
                    result = _parse_request_url(request.url)
                    if result:
                        detected.update(result)
                        print(
                            f"  {name}: [pw-chrome] {result['ats_type']} "
                            f"slug={result['slug'][:30] or '(none)'}"
                        )

                page.on('request', on_request)
                try:
                    await page.goto(careers_url, wait_until='domcontentloaded', timeout=30_000)
                    await page.wait_for_load_state('networkidle', timeout=10_000)
                except Exception:
                    pass
                await page.close()
            finally:
                await browser.close()
    except Exception as e:
        print(f"  {name}: [pw-chrome] error - {e}")
    return detected


async def detect_ats_with_playwright(
    name: str,
    careers_url: str,
    browser: Browser,
) -> dict:
    """
    Load the careers page with a real browser and detect ATS from the
    network requests it makes. The browser is passed in so callers can
    reuse one instance across multiple companies.

    For Workday and iCIMS URLs, falls back to system Chrome when Kasada
    bot-detection is identified as the reason no ATS was found.
    """
    detected: dict = {}

    try:
        page = await browser.new_page(user_agent=_UA)
        got_403 = False

        def on_request(request):
            if detected:
                return
            result = _parse_request_url(request.url)
            if result:
                detected.update(result)
                print(
                    f"  {name}: [pw] {result['ats_type']} "
                    f"slug={result['slug'][:30] or '(none)'}"
                )

        def on_response(response):
            nonlocal got_403
            if response.status == 403:
                got_403 = True

        page.on('request', on_request)
        page.on('response', on_response)

        try:
            await page.goto(careers_url, wait_until='domcontentloaded', timeout=20_000)
            await page.wait_for_load_state('networkidle', timeout=8_000)
        except Exception:
            pass  # proceed even if networkidle times out

        if not detected and _is_kasada_domain(careers_url):
            if await _is_kasada_blocked(page, got_403):
                await page.close()
                print(f"  {name}: [pw] Kasada detected, retrying with system Chrome")
                return await _detect_with_chrome(name, careers_url)

        await page.close()

    except Exception as e:
        print(f"  {name}: [pw] error - {e}")

    return detected or {'ats_type': 'html', 'slug': ''}


_JOB_TITLE_RE = re.compile(
    r'engineer|developer|designer|architect|manager|analyst|scientist|'
    r'product|marketing|sales|support|lead|senior|junior|intern|recruiter|'
    r'director|devops|security|data|fullstack|backend|frontend',
    re.IGNORECASE,
)


async def scrape_jobs_with_playwright(company: dict) -> list[dict]:
    """
    Load the careers page in a headless browser and extract job listings.
    Tries JSON-LD structured data first, then falls back to link extraction.
    """
    name = company['name']
    careers_url = company.get('careers_url', '').strip()
    if not careers_url:
        return []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            page = await browser.new_page(user_agent=_UA)
            try:
                await page.goto(careers_url, wait_until='domcontentloaded', timeout=20_000)
                await page.wait_for_load_state('networkidle', timeout=8_000)
            except Exception:
                pass

            jobs = await _extract_jobs_from_page(page, name, careers_url)
            await page.close()
            return jobs

        except Exception as e:
            print(f"Playwright scrape error for {name}: {e}")
            return []
        finally:
            await browser.close()


async def _extract_jobs_from_page(
    page: Page,
    company_name: str,
    careers_url: str,
) -> list[dict]:
    jobs = await _extract_jsonld_jobs(page, company_name, careers_url)
    if jobs:
        return jobs
    return await _extract_job_links(page, company_name, careers_url)


async def _extract_jsonld_jobs(
    page: Page,
    company_name: str,
    careers_url: str,
) -> list[dict]:
    raw_scripts: list[str] = await page.evaluate(
        "() => Array.from(document.querySelectorAll("
        "'script[type=\"application/ld+json\"]')).map(s => s.textContent)"
    )
    jobs = []
    for raw in raw_scripts:
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            continue
        items = data if isinstance(data, list) else data.get('@graph', [data])
        for item in items:
            if not isinstance(item, dict) or item.get('@type') != 'JobPosting':
                continue
            title = item.get('title', '').strip()
            if not title:
                continue
            loc = item.get('jobLocation') or {}
            if isinstance(loc, list):
                loc = loc[0] if loc else {}
            address = loc.get('address', {}) if isinstance(loc, dict) else {}
            location = address.get('addressLocality', '') if isinstance(address, dict) else ''
            desc = _strip_html(item.get('description', ''))
            jobs.append({
                'title': title,
                'company': company_name,
                'description': desc[:2000],
                'location': location,
                'url': item.get('url', careers_url),
                'source': 'company_careers',
                'salary_min': None,
                'salary_max': None,
            })
    return jobs


async def _extract_job_links(
    page: Page,
    company_name: str,
    careers_url: str,
) -> list[dict]:
    links: list[dict] = await page.evaluate(
        "() => Array.from(document.querySelectorAll('a[href]')).map(a => ({"
        "    text: a.innerText.trim().replace(/\\s+/g, ' '),"
        "    href: a.href"
        "}))"
    )
    jobs = []
    seen: set[str] = set()
    for link in links:
        text = (link.get('text') or '').strip()
        href = (link.get('href') or '').strip()
        if (
            not text or not href
            or href in seen
            or 'mailto:' in href
            or len(text) < 5 or len(text) > 150
            or not _JOB_TITLE_RE.search(text)
            or not is_valid_job_url(href, careers_url)
        ):
            continue
        seen.add(href)
        jobs.append({
            'title': text,
            'company': company_name,
            'description': '',
            'location': '',
            'url': href,
            'source': 'company_careers',
            'salary_min': None,
            'salary_max': None,
        })
    return jobs


_BAD_URL_PATTERNS = [
    r'/career/$', r'/careers/$', r'/jobs/$',
    r'/career/cat', r'/jobs/category',
    r'page=', r'category=', r'department=',
    r'/career/#', r'/jobs/#',
]


def is_valid_job_url(url: str, source_url: str) -> bool:
    if not url or not url.startswith('http'):
        return False
    if url.rstrip('/') == source_url.rstrip('/'):
        return False
    for pattern in _BAD_URL_PATTERNS:
        if re.search(pattern, url):
            return False
    return True


def _strip_html(text: str) -> str:
    if not text:
        return ''
    clean = re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'\s+', ' ', clean).strip()
