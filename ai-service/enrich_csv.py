import asyncio
import csv
import os
import re
from datetime import datetime

import httpx

CSV_PATH = os.path.join(os.path.dirname(__file__), "companies.csv")

_NAME_ALIASES = ('Company', 'company name', 'Company Name')
_URL_ALIASES = ('Careers URL', 'Careers_URL', 'careers url', 'url', 'URL')
_STANDARD_FIELDS = ['name', 'careers_url', 'ats_type', 'slug',
                    'last_crawled', 'active']


def _normalize_row(row: dict) -> dict:
    """Resolve column name aliases to the standard keys used everywhere."""
    row = {k.strip(): v for k, v in row.items()}
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
    row.setdefault('ats_type', '')
    row.setdefault('slug', '')
    row.setdefault('last_crawled', '')
    row.setdefault('active', 'true')
    return row

ATS_PATTERNS = {
    "greenhouse": [
        r'boards\.greenhouse\.io/([a-zA-Z0-9_-]+)',
        r'job-boards\.greenhouse\.io/([a-zA-Z0-9_-]+)',
        r'greenhouse\.io/([a-zA-Z0-9_-]+)',
    ],
    "lever": [
        r'jobs\.lever\.co/([a-zA-Z0-9_-]+)',
    ],
    "workable": [
        r'apply\.workable\.com/([a-zA-Z0-9_-]+)',
    ],
    "ashby": [
        r'jobs\.ashbyhq\.com/([a-zA-Z0-9_-]+)',
        r'app\.ashbyhq\.com/([a-zA-Z0-9_-]+)',
    ],
}

# Additional iframe/embed patterns scanned against raw HTML only
_IFRAME_PATTERNS = [
    (r'<iframe[^>]+src="([^"]*jobs\.lever\.co/([a-zA-Z0-9_-]+)[^"]*)"', "lever", 2),
    (r'<iframe[^>]+src="([^"]*boards\.greenhouse\.io/([a-zA-Z0-9_-]+)[^"]*)"', "greenhouse", 2),
    (r'<iframe[^>]+src="([^"]*job-boards\.greenhouse\.io/([a-zA-Z0-9_-]+)[^"]*)"', "greenhouse", 2),
    (r'<iframe[^>]+src="([^"]*app\.ashbyhq\.com/([a-zA-Z0-9_-]+)[^"]*)"', "ashby", 2),
]

_SKIP_SLUGS = {'embed', 'api', 'v1', 'jobs', 'careers', 'apply'}

# Hardcoded lookup for companies whose ATS is loaded via JS and
# cannot be detected from static HTML. Validated against live APIs.
KNOWN_ATS: dict[str, dict] = {
    # Greenhouse
    "Taboola":       {"ats_type": "greenhouse", "slug": "taboola"},
    "Lightricks":    {"ats_type": "greenhouse", "slug": "lightricks"},
    "AppsFlyer":     {"ats_type": "greenhouse", "slug": "appsflyer"},
    "JFrog":         {"ats_type": "greenhouse", "slug": "jfrog"},
    "Riskified":     {"ats_type": "greenhouse", "slug": "riskified"},
    "Orca Security": {"ats_type": "greenhouse", "slug": "orcasecurity"},
    "Salt Security": {"ats_type": "greenhouse", "slug": "saltsecurity"},
    "Cybereason":    {"ats_type": "greenhouse", "slug": "cybereason"},
    "Fireblocks":    {"ats_type": "greenhouse", "slug": "fireblocks"},
    "Melio":         {"ats_type": "greenhouse", "slug": "melio"},
    "Forter":        {"ats_type": "greenhouse", "slug": "forter"},
    "Yotpo":         {"ats_type": "greenhouse", "slug": "yotpo"},
    "Gong":          {"ats_type": "greenhouse", "slug": "gongio"},
    "Wiz":           {"ats_type": "greenhouse", "slug": "wizinc"},
    "Armis":         {"ats_type": "greenhouse", "slug": "armissecurity"},
    "Bringg":         {"ats_type": "greenhouse", "slug": "bringg"},
    "OpenWeb":        {"ats_type": "greenhouse", "slug": "openweb"},
    "Torq":           {"ats_type": "greenhouse", "slug": "torq"},
    "Cato Networks":  {"ats_type": "greenhouse", "slug": "catonetworks"},
    "Cloudflare":     {"ats_type": "greenhouse", "slug": "cloudflare"},
    # Lever
    "WalkMe":         {"ats_type": "lever", "slug": "walkme"},
}


async def detect_ats(
    name: str,
    careers_url: str,
    client: httpx.AsyncClient,
) -> dict:
    """
    Visit the careers URL and detect which ATS it uses.
    Returns ats_type and slug.
    """
    # Check the URL itself first — some companies use ATS URLs directly
    for ats_name, patterns in ATS_PATTERNS.items():
        for pattern in patterns:
            match = re.search(pattern, careers_url, re.IGNORECASE)
            if match:
                return {"ats_type": ats_name, "slug": match.group(1)}

    # Fetch the page and check final URL + HTML
    try:
        resp = await client.get(careers_url, timeout=10, follow_redirects=True)
        combined = str(resp.url) + " " + resp.text[:500_000]

        for ats_name, patterns in ATS_PATTERNS.items():
            for pattern in patterns:
                match = re.search(pattern, combined, re.IGNORECASE)
                if match:
                    slug = match.group(1)
                    if slug not in _SKIP_SLUGS:
                        print(f"  {name}: detected {ats_name} (slug: {slug})")
                        return {"ats_type": ats_name, "slug": slug}

        # Scan for iframe embeds that standard patterns may miss
        for pattern, ats_name, slug_group in _IFRAME_PATTERNS:
            match = re.search(pattern, resp.text, re.IGNORECASE)
            if match:
                slug = match.group(slug_group)
                if slug not in _SKIP_SLUGS:
                    print(f"  {name}: detected {ats_name} via iframe (slug: {slug})")
                    return {"ats_type": ats_name, "slug": slug}

        # Comeet: its JSON blob is embedded deep in the page, past the 500k limit.
        # Scan the full page text separately so we don't miss it.
        comeet_uid = re.search(
            r'comeet\.(?:com|co)/jobs/[^/"\']+/([A-Z0-9]{2,}\.[A-Z0-9]{2,})',
            resp.text, re.IGNORECASE,
        )
        if comeet_uid:
            uid = comeet_uid.group(1)
            comeet_token = re.search(
                r'careers-api/2\.0/company/[^/]+/positions/[^?]+\?token=([A-Za-z0-9]+)',
                resp.text, re.IGNORECASE,
            )
            if comeet_token:
                token = comeet_token.group(1)
                print(f"  {name}: detected comeet (uid: {uid})")
                return {"ats_type": "comeet", "slug": f"{uid}:{token}"}

        print(f"  {name}: no ATS detected -> html")
        return {"ats_type": "html", "slug": ""}

    except Exception as e:
        print(f"  {name}: error - {e}")
        return {"ats_type": "html", "slug": ""}


async def enrich_companies_csv():
    """
    Read companies.csv, detect ATS for each company, write back enriched data.
    Skips rows that already have a non-html ATS type.
    """
    rows = []
    try:
        with open(CSV_PATH, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            rows = list(reader)
    except FileNotFoundError:
        print(f"CSV not found at {CSV_PATH}")
        return

    # Normalise column names and fill missing fields
    rows = [_normalize_row(row) for row in rows]

    to_enrich = [
        row for row in rows
        if (not row.get('ats_type'))
        or (row.get('ats_type') == 'html' and not row.get('slug'))
    ]

    already_done = len(rows) - len(to_enrich)
    print(f"Total companies:  {len(rows)}")
    print(f"Already enriched: {already_done}")
    print(f"Need enrichment:  {len(to_enrich)}")
    print("Starting ATS detection...")

    # Apply hardcoded lookup table first — no HTTP needed
    lookup_hits = 0
    for row in rows:
        if row.get('ats_type') and row.get('ats_type') != 'html':
            continue
        name = row.get('name', '').strip()
        if name in KNOWN_ATS:
            row['ats_type'] = KNOWN_ATS[name]['ats_type']
            row['slug'] = KNOWN_ATS[name]['slug']
            row['last_crawled'] = datetime.now().strftime('%Y-%m-%d')
            print(f"  {name}: lookup -> {row['ats_type']} (slug: {row['slug']})")
            lookup_hits += 1

    print(f"Lookup table applied: {lookup_hits} companies resolved")
    print("Starting static ATS detection for remaining companies...")

    async with httpx.AsyncClient(
        follow_redirects=True,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
            )
        },
    ) as client:
        for row in rows:
            if row.get('ats_type') and row.get('ats_type') != 'html':
                continue

            careers_url = row.get('careers_url', '').strip()
            name = row.get('name', '').strip()
            if not careers_url or not name:
                continue

            result = await detect_ats(name, careers_url, client)
            row['ats_type'] = result['ats_type']
            row['slug'] = result['slug']
            row['last_crawled'] = datetime.now().strftime('%Y-%m-%d')

            await asyncio.sleep(1)

    greenhouse = sum(1 for r in rows if r.get('ats_type') == 'greenhouse')
    lever = sum(1 for r in rows if r.get('ats_type') == 'lever')
    comeet = sum(1 for r in rows if r.get('ats_type') == 'comeet')
    html = sum(1 for r in rows if r.get('ats_type') == 'html')

    print("\nResults:")
    print(f"  Greenhouse: {greenhouse}")
    print(f"  Lever:      {lever}")
    print(f"  Comeet:     {comeet}")
    print(f"  HTML:       {html}")

    with open(CSV_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=_STANDARD_FIELDS,
                                extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)

    print("\nSaved enriched CSV to companies.csv")


if __name__ == "__main__":
    asyncio.run(enrich_companies_csv())
