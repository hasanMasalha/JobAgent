import asyncio
import json
import os
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

_EXPAND_SELECTORS = [
    "button.show-more-less-html__button--more",
    'button[aria-label="Show more, visually expands"]',
    'button[data-tracking-control-name*="show_more"]',
    "footer.show-more-less-html button",
    ".jobs-description__footer-button",
    'button:has-text("Show more")',
    'button:has-text("more")',
]

_DESC_SELECTORS = [
    ".show-more-less-html__markup",
    ".jobs-description-content__text",
    ".jobs-box__html-content",
    "#job-details",
    ".description__text",
    '[class*="show-more-less-html"]',
]


def get_linkedin_session_path() -> str | None:
    """Get path to a saved LinkedIn browser session."""
    profile_dir = "/app/browser_profile"
    if not os.path.exists(profile_dir):
        return None

    for user_id in os.listdir(profile_dir):
        session_path = os.path.join(profile_dir, user_id)
        if os.path.isdir(session_path):
            storage_file = os.path.join(session_path, "storage_state.json")
            if os.path.exists(storage_file):
                try:
                    with open(storage_file) as f:
                        data = json.load(f)
                    cookies = data.get("cookies", [])
                    li_cookies = [
                        c for c in cookies
                        if "linkedin.com" in c.get("domain", "")
                        and c.get("name") in ["li_at", "JSESSIONID"]
                    ]
                    if li_cookies:
                        print(f"[linkedin] Found session for user {user_id}")
                        return storage_file
                except Exception:
                    pass
    return None


async def _fetch_full_description(page, job_url: str) -> str | None:
    """Navigate to a LinkedIn job detail page and extract the full expanded description."""
    try:
        await page.goto(job_url, wait_until="domcontentloaded", timeout=15000)
        await page.wait_for_timeout(2000)

        # Try to expand full description
        for selector in _EXPAND_SELECTORS:
            try:
                btn = await page.query_selector(selector)
                if btn:
                    await btn.scroll_into_view_if_needed()
                    await btn.click()
                    await page.wait_for_timeout(800)
                    print(f"[linkedin] expanded description with: {selector}")
                    break
            except Exception:
                continue

        await page.wait_for_timeout(500)

        # Remove CSS truncation as a fallback in case the button click missed
        await page.evaluate("""
            () => {
                document.querySelectorAll(
                    '.show-more-less-html, .show-more-less-html__markup'
                ).forEach(el => {
                    el.style.maxHeight = 'none';
                    el.style.overflow = 'visible';
                    el.style.webkitLineClamp = 'unset';
                    el.style.display = 'block';
                });
            }
        """)
        await page.wait_for_timeout(300)

        # Debug: dump every selector result so we can see what LinkedIn actually returns
        debug_info = await page.evaluate("""
            () => {
                const results = {};
                const selectors = [
                    '.show-more-less-html__markup',
                    '.jobs-description-content__text',
                    '.jobs-box__html-content',
                    '#job-details',
                    'article.jobs-description__container',
                    '.description__text',
                    '[class*="description"]',
                    '[class*="job-details"]',
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    results[sel] = el ? el.innerText.substring(0, 100) : 'NOT FOUND';
                }
                results['title'] = document.title;
                results['lang'] = document.documentElement.lang;
                const allEls = document.querySelectorAll('[class*="description"]');
                results['desc_classes'] = Array.from(allEls)
                    .map(el => el.className)
                    .slice(0, 5);
                return results;
            }
        """)
        job_id = job_url.rstrip("/").split("/")[-1]
        print(f"[linkedin_debug] {job_id} selectors: {debug_info}", flush=True)

        # Approach 1: CSS class selectors (original approach, after CSS reset above)
        description = await page.evaluate("""
            () => {
                const selectors = [
                    '.show-more-less-html__markup',
                    '.jobs-description-content__text',
                    '.jobs-box__html-content',
                    '#job-details',
                    '.description__text',
                    '[class*="show-more-less-html"]',
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText.trim().length > 100) {
                        return el.innerText.trim();
                    }
                }
                return '';
            }
        """)
        if description and len(description) > 100:
            return description

        # Approach 2: largest text block in main content area
        print(f"[linkedin_debug] CSS selectors missed for {job_id}, trying text-block fallback", flush=True)
        description = await page.evaluate("""
            () => {
                const candidates = [
                    document.querySelector('main'),
                    document.querySelector('#main-content'),
                    document.querySelector('[role="main"]'),
                    document.body,
                ];
                for (const container of candidates) {
                    if (!container) continue;
                    const textEls = container.querySelectorAll('p, li, h1, h2, h3, section');
                    const texts = Array.from(textEls)
                        .map(el => el.innerText.trim())
                        .filter(t => t.length > 20)
                        .join('\\n');
                    if (texts.length > 200) return texts;
                }
                return '';
            }
        """)
        if description and len(description) > 100:
            print(f"[linkedin_debug] text-block fallback succeeded len={len(description)} for {job_id}", flush=True)
            return description

        # Approach 3: BeautifulSoup on raw HTML
        print(f"[linkedin_debug] text-block fallback also missed for {job_id}, trying BeautifulSoup", flush=True)
        html = await page.content()
        print(f"[linkedin_debug] raw HTML length: {len(html)} for {job_id}", flush=True)
        soup = BeautifulSoup(html, "html.parser")
        for tag in ["main", "article"]:
            container = soup.find(tag)
            if container:
                text = container.get_text(separator="\n", strip=True)
                if len(text) > 200:
                    print(f"[linkedin_debug] BeautifulSoup <{tag}> len={len(text)} for {job_id}", flush=True)
                    return text[:3000]

        print(f"[linkedin_debug] all approaches failed for {job_id}", flush=True)
        return None
    except Exception as e:
        print(f"[linkedin] description fetch error: {e}")
        return None


_ATS_DOMAINS = [
    "greenhouse.io", "lever.co", "comeet.com",
    "ashbyhq.com", "workable.com", "bamboohr.com",
    "jobvite.com", "smartrecruiters.com", "taleo.net",
    "icims.com", "myworkdayjobs.com", "successfactors",
]


async def extract_ats_url(page) -> str | None:
    """
    Extract the actual ATS apply URL from a LinkedIn job detail page.
    Works for external apply jobs (not Easy Apply).
    Returns None if job is Easy Apply or no ATS URL found.
    """
    try:
        # Method 1: direct ATS anchor on the page
        for domain in _ATS_DOMAINS:
            link = await page.query_selector(f'a[href*="{domain}"]')
            if link:
                href = await link.get_attribute("href")
                if href:
                    print(f"[linkedin] Found ATS URL ({domain}): {href[:80]}")
                    return href

        # Method 2: apply button data attributes
        apply_btn = await page.query_selector(
            ".jobs-apply-button--top-card, "
            "button[data-job-url], "
            'a[data-tracking-control-name*="apply"]'
        )
        if apply_btn:
            for attr in ["data-job-url", "href"]:
                val = await apply_btn.get_attribute(attr)
                if val and any(d in val for d in _ATS_DOMAINS):
                    print(f"[linkedin] Found ATS URL (btn attr): {val[:80]}")
                    return val

        # Method 3: scan all anchors + JSON-LD in page source
        ats_url = await page.evaluate(
            """(domains) => {
                for (const a of document.querySelectorAll('a[href]')) {
                    const href = a.href;
                    if (domains.some(d => href.includes(d))) return href;
                }
                for (const script of document.querySelectorAll(
                    'script[type="application/ld+json"]'
                )) {
                    try {
                        const data = JSON.parse(script.textContent);
                        const url = data.url || data.applyUrl || '';
                        if (domains.some(d => url.includes(d))) return url;
                    } catch(e) {}
                }
                return null;
            }""",
            _ATS_DOMAINS,
        )
        if ats_url:
            print(f"[linkedin] Found ATS URL (JS scan): {ats_url[:80]}")
            return ats_url

    except Exception as e:
        print(f"[linkedin] extract_ats_url error: {e}")

    return None


async def extract_apply_url_with_session(
    job_url: str,
    session_path: str,
) -> str | None:
    """
    Visit a LinkedIn job page with a logged-in session, click the external
    Apply button, and capture the resulting ATS redirect URL.
    Returns None for Easy Apply jobs or when no ATS URL is found.
    """
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )

            context = await browser.new_context(
                storage_state=session_path,
                viewport={"width": 1280, "height": 800},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            )

            page = await context.new_page()
            await page.goto(job_url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(3000)

            current_url = page.url
            if "login" in current_url or "authwall" in current_url:
                print(f"[linkedin] Session expired for {session_path}")
                await browser.close()
                return None

            print("[linkedin] Logged in, looking for Apply button...")

            apply_btn = None
            selectors = [
                "button.jobs-apply-button",
                ".jobs-apply-button",
                'button[aria-label*="Apply"]',
                'a[href*="apply"]',
            ]
            for sel in selectors:
                btn = await page.query_selector(sel)
                if btn:
                    text = await btn.inner_text()
                    print(f"[linkedin] Found button: '{text}' ({sel})")
                    if "easy apply" not in text.lower():
                        apply_btn = btn
                        break

            if not apply_btn:
                print("[linkedin] No external Apply button found")
                await browser.close()
                return None

            ats_url = None

            async def handle_new_page(new_page):
                nonlocal ats_url
                try:
                    await new_page.wait_for_load_state("domcontentloaded", timeout=10000)
                    url = new_page.url
                    print(f"[linkedin] New page opened: {url}")
                    if any(d in url for d in _ATS_DOMAINS):
                        ats_url = url
                except Exception:
                    pass

            context.on("page", handle_new_page)

            await apply_btn.click()
            await page.wait_for_timeout(5000)

            if not ats_url:
                current = page.url
                if any(d in current for d in _ATS_DOMAINS):
                    ats_url = current
                    print(f"[linkedin] Redirected to ATS: {ats_url}")

            if not ats_url:
                for domain in _ATS_DOMAINS:
                    link = await page.query_selector(f'a[href*="{domain}"]')
                    if link:
                        href = await link.get_attribute("href")
                        if href:
                            ats_url = href
                            print(f"[linkedin] Found ATS link: {href}")
                            break

            await browser.close()

            if ats_url:
                print(f"[linkedin] Extracted ATS URL: {ats_url}")
            else:
                print("[linkedin] Could not extract ATS URL")

            return ats_url

    except Exception as e:
        print(f"[linkedin] extract_apply_url_with_session error: {e}")
        return None


async def fetch_linkedin_jobs_for_term(
    search_term: str,
    browser_context,
) -> list[dict]:
    """
    Two-phase scrape for a single search term.
    Phase 1: fast HTML scan of search result cards → collect URLs + metadata.
    Phase 2: navigate to each job detail page → expand and extract full description.
    """
    page = await browser_context.new_page()
    preliminary: list[dict] = []
    seen_urls: set[str] = set()

    try:
        # ── Phase 1: collect metadata from search result pages ────────────────
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

                        if not title or not job_url or job_url in seen_urls:
                            continue

                        location_lower = location.lower()
                        if location and not any(kw in location_lower for kw in _ISRAELI_KEYWORDS):
                            continue

                        # Keep snippet as fallback in case detail-page fetch fails
                        snippet_el = card.find(
                            class_=re.compile(r"description|snippet|summary|job-snippet")
                        )
                        snippet = snippet_el.get_text(strip=True) if snippet_el else ""

                        seen_urls.add(job_url)
                        preliminary.append(
                            {
                                "title": title,
                                "company": company,
                                "location": location,
                                "url": job_url,
                                "snippet": snippet,
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

        # ── Phase 2: navigate to each job page for full description + ATS URL ──
        jobs: list[dict] = []
        session_path = get_linkedin_session_path()
        for meta in preliminary:
            desc = await _fetch_full_description(page, meta["url"])

            # Page is already at the LinkedIn job detail URL after _fetch_full_description.
            # Attempt to extract the real ATS apply URL while still on this page.
            ats_url = await extract_ats_url(page)
            if ats_url:
                print(f"[linkedin] Found ATS apply URL: {ats_url[:80]}")
            elif session_path:
                ats_url = await extract_apply_url_with_session(meta["url"], session_path)

            if desc and len(desc) >= 100:
                description = desc
            elif meta["snippet"]:
                description = meta["snippet"]
            else:
                description = f"{meta['title']} at {meta['company']}, {meta['location']}".strip(", ")

            jobs.append(
                {
                    "title": meta["title"],
                    "company": meta["company"],
                    "description": description,
                    "location": meta["location"],
                    "url": meta["url"],      # LinkedIn URL — used for viewing the job
                    "apply_url": ats_url,    # ATS URL — used for auto-applying (None if Easy Apply / not found)
                    "source": "linkedin",
                    "salary_min": None,
                    "salary_max": None,
                }
            )
            await asyncio.sleep(1)

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
