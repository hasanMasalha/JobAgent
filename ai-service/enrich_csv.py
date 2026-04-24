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
    ],
}

_SKIP_SLUGS = {'embed', 'api', 'v1', 'jobs', 'careers', 'apply'}


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
        combined = str(resp.url) + " " + resp.text[:8000]

        for ats_name, patterns in ATS_PATTERNS.items():
            for pattern in patterns:
                match = re.search(pattern, combined, re.IGNORECASE)
                if match:
                    slug = match.group(1)
                    if slug not in _SKIP_SLUGS:
                        print(f"  {name}: detected {ats_name} (slug: {slug})")
                        return {"ats_type": ats_name, "slug": slug}

        print(f"  {name}: no ATS detected → html")
        return {"ats_type": "html", "slug": ""}

    except Exception as e:
        print(f"  {name}: error — {e}")
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
    html = sum(1 for r in rows if r.get('ats_type') == 'html')

    print("\nResults:")
    print(f"  Greenhouse: {greenhouse}")
    print(f"  Lever:      {lever}")
    print(f"  HTML:       {html}")

    with open(CSV_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=_STANDARD_FIELDS,
                                extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nSaved enriched CSV to {CSV_PATH}")


if __name__ == "__main__":
    asyncio.run(enrich_companies_csv())
