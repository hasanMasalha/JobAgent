import asyncio
import csv
import re
from datetime import datetime

import httpx

# Starting list of Israeli tech companies to discover
COMPANIES_TO_DISCOVER = [
    "Wix",
    "Monday.com",
    "Fiverr",
    "Taboola",
    "Outbrain",
    "Similarweb",
    "Varonis",
    "CyberArk",
    "Amdocs",
    "NICE Systems",
    "Radware",
    "Elementor",
    "Walkme",
    "Payoneer",
    "eToro",
    "Lemonade",
    "Papaya Global",
    "ironSource",
    "Kaltura",
    "Gett",
    "Via Transportation",
    "Lightricks",
    "Namogoo",
    "Cloudinary",
    "Guesty",
    "Minute Media",
    "Riskified",
    "Nuvei",
    "Global-E",
    "Skai",
]

# Map company names to their base URLs
COMPANY_BASE_URLS = {
    "Wix":            "https://www.wix.com",
    "Monday.com":     "https://monday.com",
    "Fiverr":         "https://www.fiverr.com",
    "Taboola":        "https://www.taboola.com",
    "Outbrain":       "https://www.outbrain.com",
    "Similarweb":     "https://www.similarweb.com",
    "Varonis":        "https://www.varonis.com",
    "CyberArk":       "https://www.cyberark.com",
    "Amdocs":         "https://www.amdocs.com",
    "NICE Systems":   "https://www.nice.com",
    "Radware":        "https://www.radware.com",
    "Elementor":      "https://elementor.com",
    "Walkme":         "https://www.walkme.com",
    "Payoneer":       "https://www.payoneer.com",
    "eToro":          "https://www.etoro.com",
    "Lemonade":       "https://www.lemonade.com",
    "Papaya Global":  "https://www.papayaglobal.com",
    "ironSource":     "https://www.ironsrc.com",
    "Kaltura":        "https://corp.kaltura.com",
    "Gett":           "https://gett.com",
    "Via Transportation": "https://ridewithvia.com",
    "Lightricks":     "https://www.lightricks.com",
    "Namogoo":        "https://www.namogoo.com",
    "Cloudinary":     "https://cloudinary.com",
    "Guesty":         "https://www.guesty.com",
    "Minute Media":   "https://www.minutemedia.com",
    "Riskified":      "https://www.riskified.com",
    "Nuvei":          "https://www.nuvei.com",
    "Global-E":       "https://www.global-e.com",
    "Skai":           "https://skai.io",
}

CSV_PATH = "companies.csv"

CAREERS_PATHS = [
    "/careers",
    "/jobs",
    "/work-with-us",
    "/join-us",
    "/join-our-team",
    "/about/careers",
    "/company/careers",
    "/en/careers",
    "/about-us/careers",
]

ATS_PATTERNS = {
    "greenhouse": r'greenhouse\.io/(?:boards/)?([a-zA-Z0-9_-]+)',
    "lever":      r'jobs\.lever\.co/([a-zA-Z0-9_-]+)',
    "workable":   r'apply\.workable\.com/([a-zA-Z0-9_-]+)',
    "ashby":      r'jobs\.ashbyhq\.com/([a-zA-Z0-9_-]+)',
    "workday":    r'myworkdayjobs\.com',
    "smartrecruiters": r'jobs\.smartrecruiters\.com/([a-zA-Z0-9_-]+)',
}

_HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
}


async def find_careers_url(
    company_name: str,
    base_url: str,
    client: httpx.AsyncClient,
) -> dict:
    """
    Try common careers URL patterns for a company.
    Returns dict with careers_url, ats_type, slug.
    """
    result = {
        "name": company_name,
        "careers_url": "",
        "ats_type": "unknown",
        "slug": "",
        "last_crawled": datetime.now().strftime("%Y-%m-%d"),
        "active": "true",
    }

    for path in CAREERS_PATHS:
        url = base_url.rstrip('/') + path
        try:
            resp = await client.get(url, timeout=10)

            if resp.status_code == 200:
                final_url = str(resp.url)
                html = resp.text

                combined = final_url + " " + html[:5000]

                for ats_name, pattern in ATS_PATTERNS.items():
                    match = re.search(pattern, combined, re.IGNORECASE)
                    if match:
                        result["careers_url"] = final_url
                        result["ats_type"] = ats_name
                        if match.lastindex and match.lastindex >= 1:
                            result["slug"] = match.group(1)
                        print(f"  {company_name}: found {ats_name} "
                              f"at {final_url}")
                        return result

                result["careers_url"] = final_url
                result["ats_type"] = "html"
                print(f"  {company_name}: found HTML careers page "
                      f"at {final_url}")
                return result

        except Exception:
            continue

    print(f"  {company_name}: no careers page found")
    return result


async def discover_all_companies() -> dict:
    """
    Run discovery for all companies and save to CSV.
    Skips companies already in the CSV.
    Returns summary with discovered count.
    """
    existing = {}
    try:
        with open(CSV_PATH, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                existing[row['name']] = row
    except FileNotFoundError:
        pass

    new_results = []
    to_discover = [
        name for name in COMPANIES_TO_DISCOVER
        if name not in existing
    ]

    if not to_discover:
        print("All companies already discovered. Nothing to do.")
        return {"discovered": 0, "total": 0, "csv_path": CSV_PATH}

    print(f"Discovering careers URLs for {len(to_discover)} companies...")

    async with httpx.AsyncClient(
        follow_redirects=True,
        headers=_HTTP_HEADERS,
    ) as client:
        for name in to_discover:
            base_url = COMPANY_BASE_URLS.get(name, "")
            if not base_url:
                print(f"  {name}: no base URL configured, skipping")
                continue

            result = await find_careers_url(name, base_url, client)
            new_results.append(result)
            await asyncio.sleep(1.5)

    all_results = list(existing.values()) + new_results

    fieldnames = [
        "name", "careers_url", "ats_type",
        "slug", "last_crawled", "active"
    ]

    with open(CSV_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_results)

    found = sum(1 for r in new_results if r['careers_url'])
    print(f"\nSaved {len(all_results)} companies to {CSV_PATH}")
    print(f"Found careers URLs: {found}/{len(new_results)}")

    return {"discovered": found, "total": len(new_results), "csv_path": CSV_PATH}


async def discover_one_company(name: str, base_url: str) -> dict:
    """
    Discover careers URL for a single company and upsert into CSV.
    """
    existing = {}
    try:
        with open(CSV_PATH, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                existing[row['name']] = row
    except FileNotFoundError:
        pass

    async with httpx.AsyncClient(
        follow_redirects=True,
        headers=_HTTP_HEADERS,
    ) as client:
        result = await find_careers_url(name, base_url, client)

    existing[name] = result
    all_results = list(existing.values())

    fieldnames = [
        "name", "careers_url", "ats_type",
        "slug", "last_crawled", "active"
    ]

    with open(CSV_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_results)

    return result
