"""
Verify Greenhouse, Lever, and Comeet slugs before adding to companies.csv.
Run from ai-service/: python verify_companies.py
"""
import asyncio
import csv

import httpx

CSV_PATH = "companies.csv"

# Load existing slugs so we can flag duplicates
_existing: set[str] = set()
with open(CSV_PATH, newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        s = (row.get("slug") or "").strip()
        n = (row.get("name") or "").strip().lower()
        if s:
            _existing.add(s)
        _existing.add(n)


def _dup(slug: str, name: str) -> str:
    if slug in _existing or name.lower() in _existing:
        return " [ALREADY IN CSV]"
    return ""


GREENHOUSE = [
    ("monday", "monday.com"),
    ("wix", "Wix"),
    ("fiverr", "Fiverr"),
    ("ironSource", "IronSource"),
    ("checkpointsw", "Check Point"),
    ("amdocs", "Amdocs"),
    ("sentinelone", "SentinelOne"),
    ("cyberark", "CyberArk"),
    ("radware", "Radware"),
    ("imperva", "Imperva"),
    ("mobileye", "Mobileye"),
    ("outbrain", "Outbrain"),
    ("varonis", "Varonis"),
    ("aquasecurity", "Aqua Security"),
    ("snyk", "Snyk"),
    ("deepinstinct", "Deep Instinct"),
    ("solaredge", "SolarEdge"),
    ("atera", "Atera"),
    ("nayax", "Nayax"),
    ("nuvei", "Nuvei"),
    ("samsara", "Samsara"),
    ("elbit", "Elbit Systems"),
    ("rafael", "Rafael"),
]

# Lever: use the public postings API directly (same endpoint the scraper uses)
LEVER = [
    ("gong-io", "Gong"),
    ("lusha", "Lusha"),
    ("lemonade", "Lemonade"),
    ("papayaglobal", "Papaya Global"),
    ("overwolf", "Overwolf"),
    ("kaltura", "Kaltura"),
    ("similarweb", "SimilarWeb"),
    ("fundbox", "Fundbox"),
    ("monday", "monday.com"),
    ("payoneer", "Payoneer"),
    ("appsflyer", "AppsFlyer"),
]

# Comeet: scraper uses uid:token from the careers API.
# We can't discover uid:token from the slug alone, so verify the web page
# exists and note it needs manual uid extraction.
COMEET_WEB = [
    ("classiq", "Classiq"),
    ("armis", "Armis"),
    ("cybereason", "Cybereason"),
    ("transmitsecurity", "Transmit Security"),
    ("incredibuild", "Incredibuild"),
    ("syte", "Syte.ai"),
    ("guardicore", "Guardicore"),
]


async def verify():
    async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:

        print("=" * 60)
        print("GREENHOUSE  (boards-api.greenhouse.io)")
        print("=" * 60)
        gh_ok: list[tuple[str, str, int]] = []
        for slug, name in GREENHOUSE:
            dup = _dup(slug, name)
            try:
                r = await client.get(
                    f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"
                )
                count = len(r.json().get("jobs", [])) if r.status_code == 200 else 0
                icon = "OK" if r.status_code == 200 else "--"
                print(f"  {icon} {slug:20} {r.status_code}  ({count:3d} jobs)  {name}{dup}")
                if r.status_code == 200:
                    gh_ok.append((slug, name, count))
            except Exception as e:
                print(f"  -- {slug:20} ERROR: {e}")

        print()
        print("=" * 60)
        print("LEVER  (api.lever.co postings)")
        print("=" * 60)
        lv_ok: list[tuple[str, str, int]] = []
        for slug, name in LEVER:
            dup = _dup(slug, name)
            try:
                r = await client.get(
                    f"https://api.lever.co/v0/postings/{slug}?mode=json"
                )
                count = len(r.json()) if r.status_code == 200 else 0
                icon = "OK" if r.status_code == 200 else "--"
                print(f"  {icon} {slug:20} {r.status_code}  ({count:3d} jobs)  {name}{dup}")
                if r.status_code == 200:
                    lv_ok.append((slug, name, count))
            except Exception as e:
                print(f"  -- {slug:20} ERROR: {e}")

        print()
        print("=" * 60)
        print("COMEET  (web page only — uid:token must be extracted manually)")
        print("=" * 60)
        for slug, name in COMEET_WEB:
            dup = _dup(slug, name)
            try:
                r = await client.get(f"https://www.comeet.com/jobs/{slug}")
                icon = "OK" if r.status_code == 200 else "--"
                print(f"  {icon} {slug:20} {r.status_code}  {name}{dup}")
            except Exception as e:
                print(f"  -- {slug:20} ERROR: {e}")

        print()
        print("=" * 60)
        print("SUMMARY — new valid entries to add to companies.csv")
        print("=" * 60)
        today = "2026-06-16"
        print("\n-- Greenhouse --")
        for slug, name, count in gh_ok:
            if slug not in _existing and name.lower() not in _existing:
                url = f"https://boards.greenhouse.io/{slug}"
                print(f"  {name}, {url},greenhouse,{slug},{today},true   ({count} jobs)")

        print("\n-- Lever --")
        for slug, name, count in lv_ok:
            if slug not in _existing and name.lower() not in _existing:
                url = f"https://jobs.lever.co/{slug}"
                print(f"  {name}, {url},lever,{slug},{today},true   ({count} jobs)")


asyncio.run(verify())
