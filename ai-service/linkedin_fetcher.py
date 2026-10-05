import asyncio
import json
import os
import re
import time
from urllib.parse import quote, urlencode

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

from linkedin_easy_apply import detect_easy_apply, linkedin_job_id
from scrape_timing import PhaseTimer

LINKEDIN_SEARCH_TERMS = [
    "software engineer",
    "backend developer",
    "frontend developer",
    "product manager",
    "data engineer",
    "devops engineer",
    "fullstack developer",
    "mobile developer",
    "machine learning engineer",
]

# The daily scrape (/scrape-and-store) must finish inside the workflow's 55 min
# SSH timeout, with Indeed, the other scrapers and embedding still to run.
LINKEDIN_BUDGET_SECONDS = float(os.environ.get("LINKEDIN_SCRAPE_BUDGET_MIN", "25")) * 60

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


# The "Show more" click used to be a Playwright mouse click with the default
# 30s timeout. Logged out, LinkedIn covers the page with a sign-in prompt, so
# every click waited the full 30s and failed — for each of the ~4 selectors
# that matched: about 125s per job page in the 2026-10-04 timing run, so the
# 25-min LinkedIn budget ran out inside the first search and only Israel got
# LinkedIn jobs. A DOM click can't be blocked and returns at once.


async def _expand_description(page) -> None:
    """Click the description's "Show more" if there is a visible one, with a
    DOM click. The CSS reset after this covers a missed click."""
    for selector in _EXPAND_SELECTORS:
        try:
            btn = await page.query_selector(selector)
            if not btn or not await btn.is_visible():
                continue
            # A DOM click, not a mouse click: logged out, LinkedIn lays a
            # sign-in prompt over the page, and Playwright's mouse click waits
            # for it to go away until the timeout, for every matching button.
            await btn.evaluate("b => b.click()")
            await page.wait_for_timeout(800)
            print(f"[linkedin] expanded description with: {selector}")
            return
        except Exception:
            continue


async def _fetch_full_description(page, job_url: str) -> str | None:
    """Navigate to a LinkedIn job detail page and extract the full expanded description."""
    try:
        await page.goto(job_url, wait_until="domcontentloaded", timeout=15000)
        await page.wait_for_timeout(2000)

        await _expand_description(page)

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


def _card_location(card) -> str:
    """The location line of a search result card, and nothing else.

    The location sits inside the card's metadata block next to the posted time
    and badges such as "Be an early applicant". Reading the whole block ran
    them together ("New York, NY17 hours ago"), so only the location element
    itself is read.
    """
    el = card.find(class_="job-search-card__location") or card.find(
        class_=re.compile(r"location")
    )
    if not el:
        return ""
    return " ".join(el.get_text(" ", strip=True).split())


def _search_url(search_term: str, location: str, start: int) -> str:
    # location is required: without it LinkedIn answers for wherever the
    # requesting IP is, which made every LinkedIn job American.
    query = urlencode(
        {"keywords": search_term, "location": location, "f_TPR": "r86400", "start": start},
        quote_via=quote,
    )
    return f"https://www.linkedin.com/jobs/search?{query}"


async def fetch_linkedin_jobs_for_term(
    search_term: str,
    location: str,
    browser_context,
    deadline: float | None = None,
    known: dict[str, str] | None = None,
    timer: PhaseTimer | None = None,
    handled: set[str] | None = None,
) -> list[dict]:
    """
    Two-phase scrape for a single search term in one location.
    Phase 1: fast HTML scan of search result cards → collect URLs + metadata.
    Phase 2: navigate to each job detail page → expand and extract full description.
    Phase 2 stops early at the deadline (time.monotonic()), keeping what it has.

    known maps LinkedIn job ids already stored with a full description to
    their stored URL. Those jobs skip phase 2 — the detail visit is the slow
    part — and come back as {"known": True, url, location} so the caller can
    mark them seen without re-scraping them.

    handled is shared across a run's searches: a job id in it was already
    dealt with by an earlier search and is skipped here.
    """
    known = known or {}
    timer = timer or PhaseTimer()
    handled = handled if handled is not None else set()
    page = await browser_context.new_page()
    preliminary: list[dict] = []
    seen_urls: set[str] = set()

    try:
        # ── Phase 1: collect metadata from search result pages ────────────────
        for start in [0, 25, 50]:
            url = _search_url(search_term, location, start)
            search_started = time.perf_counter()

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

                        card_location = _card_location(card)

                        link_el = card.find("a", href=True)
                        job_url = ""
                        if link_el:
                            href = link_el["href"]
                            job_url = href.split("?")[0] if "?" in href else href
                            if not job_url.startswith("http"):
                                job_url = "https://www.linkedin.com" + job_url

                        if not title or not job_url or job_url in seen_urls:
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
                                "location": card_location,
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
            finally:
                timer.add("linkedin: search pages", location, time.perf_counter() - search_started)

        # ── Phase 2: navigate to each job page for full description + ATS URL ──
        jobs: list[dict] = []
        session_path = get_linkedin_session_path()
        for meta in preliminary:
            if deadline is not None and time.monotonic() > deadline:
                print(f"  LinkedIn: time budget reached during '{search_term}' in {location}")
                break

            job_id = linkedin_job_id(meta["url"]) or meta["url"]
            if job_id in handled:
                # Already returned by an earlier search this run.
                timer.count("linkedin: repeat in this run, skipped", location)
                continue
            handled.add(job_id)

            stored_url = known.get(job_id)
            if stored_url:
                timer.count("linkedin: known, detail skipped", location)
                jobs.append(
                    {"known": True, "url": stored_url, "location": meta["location"], "source": "linkedin"}
                )
                continue

            with timer.phase("linkedin detail: description", location):
                desc = await _fetch_full_description(page, meta["url"])

            # Page is already at the LinkedIn job detail URL after _fetch_full_description.
            # Attempt to extract the real ATS apply URL while still on this page.
            # Same page: does LinkedIn mark the apply button on-site (Easy Apply)?
            # Only trusted when the page really is this job — a failed
            # navigation leaves the previous job's page open.
            is_easy_apply = None
            try:
                job_id = linkedin_job_id(meta["url"])
                if job_id and job_id in page.url:
                    with timer.phase("linkedin detail: easy apply check", location):
                        is_easy_apply = detect_easy_apply(await page.content())
            except Exception as e:
                print(f"[linkedin] easy apply check error: {e}")

            with timer.phase("linkedin detail: ats url on page", location):
                ats_url = await extract_ats_url(page)
            if ats_url:
                print(f"[linkedin] Found ATS apply URL: {ats_url[:80]}")
            elif session_path and is_easy_apply is not True:
                # Launches its own browser for each job.
                with timer.phase("linkedin detail: session apply url", location):
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
                    # True / False / None (unknown) — routes/jobs.py stores
                    # apply_type 'extension' only for True.
                    "is_easy_apply": is_easy_apply,
                    "source": "linkedin",
                    "salary_min": None,
                    "salary_max": None,
                }
            )
            with timer.phase("linkedin detail: pacing sleep", location):
                await asyncio.sleep(1)

    finally:
        await page.close()

    return jobs


async def fetch_all_linkedin_jobs(
    locations: list[str],
    budget_seconds: float = LINKEDIN_BUDGET_SECONDS,
    known: dict[str, str] | None = None,
    timer: PhaseTimer | None = None,
) -> list[dict]:
    """Fetch LinkedIn jobs for every search term in every location, sharing one
    Playwright browser.

    Each new job costs a detail-page visit, so the run has a time budget. Terms
    are the outer loop: when the budget runs out, the remaining terms are
    dropped for every location alike instead of whole locations going
    unsearched. Jobs in known (see fetch_linkedin_jobs_for_term) skip the visit.
    """
    timer = timer or PhaseTimer()
    handled: set[str] = set()
    deadline = time.monotonic() + budget_seconds
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

            searches = [(t, loc) for t in LINKEDIN_SEARCH_TERMS for loc in locations]
            done = 0
            for term, location in searches:
                if time.monotonic() > deadline:
                    break
                print(f"  LinkedIn: searching '{term}' in {location}...")
                jobs = await fetch_linkedin_jobs_for_term(
                    term, location, context, deadline, known, timer, handled
                )

                for job in jobs:
                    url = job.get("url", "")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        all_jobs.append(job)

                done += 1
                new = sum(1 for j in jobs if not j.get("known"))
                print(f"  LinkedIn '{term}' in {location}: {new} new, {len(jobs) - new} already stored")
                with timer.phase("linkedin: pacing between searches", location):
                    await asyncio.sleep(3)

            await browser.close()

        if done < len(searches):
            print(
                f"LinkedIn: time budget ({budget_seconds / 60:.0f} min) reached after "
                f"{done}/{len(searches)} searches; skipped: {searches[done:]}"
            )
        print(f"LinkedIn total: {len(all_jobs)} unique jobs")
        return all_jobs

    except Exception as e:
        print(f"LinkedIn Playwright fetcher failed: {e}")
        print("Continuing without LinkedIn jobs...")
        return []
