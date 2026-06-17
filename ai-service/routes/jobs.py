import csv
import html
import os
import re

import asyncpg
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ats_discovery import auto_discover_israeli_companies
from company_discovery import CSV_PATH, discover_all_companies, discover_one_company
from company_scraper import is_israeli_job
from embedder import embed
from scraper import enrich_short_descriptions, scrape_israel_jobs

router = APIRouter()


def _clean_description(text: str) -> str:
    """Unescape HTML entities and strip markdown artifacts from scraped descriptions."""
    if not text:
        return ""
    text = html.unescape(text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)   # strip **bold**
    text = re.sub(r"^-{3,}$", "", text, flags=re.MULTILINE)  # remove HR lines
    text = re.sub(r"\n{3,}", "\n\n", text)             # collapse excess blank lines
    text = re.sub(r"[ \t]+", " ", text)                # collapse spaces/tabs
    return text.strip()

_AUTO_ATS = {
    "greenhouse.io", "lever.co", "ashbyhq.com",
    "smartrecruiters.com", "bamboohr.com", "workable.com",
}
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")


def _detect_apply_type(job: dict) -> str:
    url = (job.get("url") or "").lower()
    apply_url = (job.get("apply_url") or "").lower()
    desc = job.get("description") or ""
    # apply_url is the confirmed ATS URL; prefer it over the listing URL
    check = apply_url or url
    if any(ats in check for ats in _AUTO_ATS):
        return "auto"
    if _EMAIL_RE.search(desc):
        return "auto"
    if "linkedin.com" in url and "/jobs/view/" in url:
        if job.get("is_easy_apply") is True:
            return "extension"
        return "external"
    return "external"


def _detect_ats(url: str, apply_url: str = "") -> str | None:
    """Detect ATS platform — checks apply_url first (more reliable), then url."""
    check = apply_url or url
    if not check:
        return None
    u = check.lower()
    if "greenhouse.io" in u:
        return "greenhouse"
    if "lever.co" in u:
        return "lever"
    if "workable.com" in u:
        return "workable"
    if "bamboohr.com" in u:
        return "bamboohr"
    if "comeet.com" in u:
        return "comeet"
    if "teamtailor.com" in u:
        return "teamtailor"
    if "ashbyhq.com" in u:
        return "ashby"
    return None


@router.post("/scrape-and-store")
async def scrape_and_store():
    jobs = await scrape_israel_jobs()
    if not jobs:
        return {"new_jobs": 0, "total_processed": 0}

    jobs = [
        j for j in jobs
        if is_israeli_job({'location': j.get('location', '') or j.get('job_location', '')})
    ]

    # Enrich Indeed jobs that have short descriptions
    jobs = await enrich_short_descriptions(jobs)

    # Drop jobs whose descriptions are still too short to be useful for matching
    jobs = [j for j in jobs if len((j.get("description") or "").strip()) >= 50]
    print(f"[scrape] {len(jobs)} jobs after filtering short descriptions")

    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    new_jobs = 0
    updated_jobs = 0
    try:
        for job in jobs:
            if not (job.get("description") or "").strip():
                continue  # never store jobs without a description
            description = _clean_description(job["description"])
            embed_text = f"{job['title']} {description[:500]}"
            embedding = embed(embed_text)
            embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

            apply_url = job.get("apply_url") or None
            row = await conn.fetchrow(
                """
                INSERT INTO "Job" (id, title, company, description, location,
                                   url, apply_url, source, salary_min, salary_max,
                                   embedding, apply_type, ats_platform, scraped_at)
                VALUES (gen_random_uuid(), $1, $2, $3, $4,
                        $5, $12, $6, $7, $8,
                        $9::vector, $10, $11, now())
                ON CONFLICT (url) DO UPDATE
                    SET description   = CASE
                                          WHEN length(EXCLUDED.description) > length(COALESCE("Job".description, ''))
                                          THEN EXCLUDED.description
                                          ELSE "Job".description
                                        END,
                        embedding     = CASE
                                          WHEN length(EXCLUDED.description) > length(COALESCE("Job".description, ''))
                                          THEN EXCLUDED.embedding
                                          ELSE "Job".embedding
                                        END,
                        apply_url     = COALESCE(EXCLUDED.apply_url, "Job".apply_url),
                        apply_type    = EXCLUDED.apply_type,
                        ats_platform  = COALESCE("Job".ats_platform, EXCLUDED.ats_platform),
                        is_active     = true,
                        scraped_at    = now()
                RETURNING (xmax = 0) AS is_insert
                """,
                job["title"],
                job["company"],
                description,
                job["location"],
                job["url"],
                job["source"],
                job["salary_min"],
                job["salary_max"],
                embedding_str,
                _detect_apply_type(job),
                _detect_ats(job.get("url", ""), apply_url or ""),
                apply_url,
            )
            if row is None:
                pass  # conflict but description was already long enough — skip
            elif row["is_insert"]:
                new_jobs += 1
            else:
                updated_jobs += 1
    finally:
        await conn.close()

    return {"new_jobs": new_jobs, "updated_jobs": updated_jobs, "total_processed": len(jobs)}


@router.post("/companies/discover")
async def trigger_discovery():
    return await discover_all_companies()


@router.get("/companies/list")
async def list_companies():
    try:
        with open(CSV_PATH, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            return list(reader)
    except FileNotFoundError:
        return []


class AddCompanyRequest(BaseModel):
    name: str
    base_url: str


@router.post("/companies/add")
async def add_company(req: AddCompanyRequest):
    return await discover_one_company(req.name, req.base_url)


class ToggleCompanyRequest(BaseModel):
    name: str
    active: bool


@router.post("/companies/toggle")
async def toggle_company(req: ToggleCompanyRequest):
    rows = []
    updated = False
    fieldnames = None
    try:
        with open(CSV_PATH, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            for row in reader:
                if row['name'] == req.name:
                    row['active'] = str(req.active).lower()
                    updated = True
                rows.append(row)
    except FileNotFoundError:
        return JSONResponse(status_code=404, content={"error": "companies.csv not found"})

    if not updated:
        return JSONResponse(status_code=404, content={"error": f"Company '{req.name}' not found"})

    with open(CSV_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return {"success": True}


@router.post("/companies/auto-discover")
async def trigger_auto_discovery():
    return await auto_discover_israeli_companies()


@router.post("/companies/enrich")
async def enrich_companies():
    from enrich_csv import enrich_companies_csv
    await enrich_companies_csv()
    return {"status": "done"}


@router.post("/companies/scrape-test")
async def scrape_test():
    from company_scraper import (
        enrich_empty_descriptions,
        is_israeli_job,
        load_companies,
        scrape_company,
    )

    companies = load_companies()[:5]
    all_jobs = []
    for company in companies:
        jobs = await scrape_company(company)
        all_jobs.extend(jobs)

    before = len(all_jobs)
    all_jobs = [j for j in all_jobs if is_israeli_job(j)]
    after = len(all_jobs)

    all_jobs = await enrich_empty_descriptions(all_jobs)

    return {
        "companies_tested": [c['name'] for c in companies],
        "jobs_before_filter": before,
        "jobs_after_filter": after,
        "jobs": [
            {
                "title": j["title"],
                "company": j["company"],
                "location": j["location"],
                "description_length": len(j.get("description", "")),
                "description_preview": j.get("description", "")[:100],
                "url": j["url"],
            }
            for j in all_jobs
        ],
    }


@router.post("/companies/scrape-and-store")
async def scrape_and_store_company_careers():
    from company_scraper import scrape_all_company_careers

    jobs = await scrape_all_company_careers()
    if not jobs:
        return {"new_jobs": 0, "updated_jobs": 0, "total_processed": 0}

    jobs_before = len(jobs)
    jobs = [j for j in jobs if is_israeli_job(j)]
    print(f"Israel filter (route): {jobs_before} -> {len(jobs)} jobs")

    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    new_jobs = 0
    updated_jobs = 0
    skipped = 0
    try:
        for job in jobs:
            if not job.get("url", "").strip():
                skipped += 1
                continue
            description = _clean_description(job.get("description", ""))
            embed_text = f"{job['title']} {description[:500]}".strip()
            embedding = embed(embed_text)
            embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

            apply_url = job.get("apply_url") or None
            row = await conn.fetchrow(
                """
                INSERT INTO "Job" (id, title, company, description, location,
                                   url, apply_url, source, salary_min, salary_max,
                                   embedding, apply_type, ats_platform, scraped_at)
                VALUES (gen_random_uuid(), $1, $2, $3, $4,
                        $5, $12, $6, $7, $8,
                        $9::vector, $10, $11, now())
                ON CONFLICT (url) DO UPDATE
                    SET description   = CASE
                                          WHEN length(EXCLUDED.description) > length(COALESCE("Job".description, ''))
                                          THEN EXCLUDED.description
                                          ELSE "Job".description
                                        END,
                        embedding     = CASE
                                          WHEN length(EXCLUDED.description) > length(COALESCE("Job".description, ''))
                                          THEN EXCLUDED.embedding
                                          ELSE "Job".embedding
                                        END,
                        apply_url     = COALESCE(EXCLUDED.apply_url, "Job".apply_url),
                        apply_type    = EXCLUDED.apply_type,
                        ats_platform  = COALESCE("Job".ats_platform, EXCLUDED.ats_platform),
                        is_active     = true,
                        scraped_at    = now()
                RETURNING (xmax = 0) AS is_insert
                """,
                job["title"],
                job["company"],
                description,
                job.get("location", ""),
                job["url"],
                job["source"],
                job.get("salary_min"),
                job.get("salary_max"),
                embedding_str,
                _detect_apply_type(job),
                _detect_ats(job.get("url", ""), apply_url or ""),
                apply_url,
            )
            if row is None:
                pass
            elif row["is_insert"]:
                new_jobs += 1
            else:
                updated_jobs += 1
    finally:
        await conn.close()

    return {
        "new_jobs": new_jobs,
        "updated_jobs": updated_jobs,
        "skipped": skipped,
        "total_processed": len(jobs),
    }


@router.post("/companies/scrape-api-only")
async def scrape_api_companies_only():
    """Scrape only API-based ATS companies (fast)."""
    from company_scraper import load_companies, scrape_company

    companies = load_companies()

    api_companies = [
        c for c in companies
        if c.get('ats_type') in ('greenhouse', 'comeet', 'lever', 'ashby')
        and c.get('active', 'true').lower() == 'true'
    ]

    print(f"[company-api] Scraping {len(api_companies)} API companies")

    all_jobs: list[dict] = []
    summary: list[dict] = []
    failed = 0

    for company in api_companies:
        try:
            jobs = await scrape_company(company)
            all_jobs.extend(jobs)
            summary.append({'name': company.get('name'), 'ats': company.get('ats_type'), 'jobs': len(jobs)})
            print(f"[company-api] {company.get('name')}: {len(jobs)} jobs")
        except Exception as e:
            failed += 1
            print(f"[company-api] ERROR {company.get('name')}: {e}")

    if not all_jobs:
        return {"new_jobs": 0, "updated_jobs": 0, "total_processed": 0, "failed": failed, "companies": summary}

    jobs_before = len(all_jobs)
    all_jobs = [j for j in all_jobs if is_israeli_job(j)]
    print(f"[company-api] Israel filter: {jobs_before} -> {len(all_jobs)} jobs")

    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    new_jobs = 0
    updated_jobs = 0
    skipped = 0
    try:
        for job in all_jobs:
            if not job.get("url", "").strip():
                skipped += 1
                continue
            description = _clean_description(job.get("description", ""))
            embed_text = f"{job['title']} {description[:500]}".strip()
            embedding = embed(embed_text)
            embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

            apply_url = job.get("apply_url") or None
            row = await conn.fetchrow(
                """
                INSERT INTO "Job" (id, title, company, description, location,
                                   url, apply_url, source, salary_min, salary_max,
                                   embedding, apply_type, ats_platform, scraped_at)
                VALUES (gen_random_uuid(), $1, $2, $3, $4,
                        $5, $12, $6, $7, $8,
                        $9::vector, $10, $11, now())
                ON CONFLICT (url) DO UPDATE
                    SET description   = CASE
                                          WHEN length(EXCLUDED.description) > length(COALESCE("Job".description, ''))
                                          THEN EXCLUDED.description
                                          ELSE "Job".description
                                        END,
                        embedding     = CASE
                                          WHEN length(EXCLUDED.description) > length(COALESCE("Job".description, ''))
                                          THEN EXCLUDED.embedding
                                          ELSE "Job".embedding
                                        END,
                        apply_url     = COALESCE(EXCLUDED.apply_url, "Job".apply_url),
                        apply_type    = EXCLUDED.apply_type,
                        ats_platform  = COALESCE("Job".ats_platform, EXCLUDED.ats_platform),
                        is_active     = true,
                        scraped_at    = now()
                RETURNING (xmax = 0) AS is_insert
                """,
                job["title"],
                job["company"],
                description,
                job.get("location", ""),
                job["url"],
                job["source"],
                job.get("salary_min"),
                job.get("salary_max"),
                embedding_str,
                _detect_apply_type(job),
                _detect_ats(job.get("url", ""), apply_url or ""),
                apply_url,
            )
            if row is None:
                pass
            elif row["is_insert"]:
                new_jobs += 1
            else:
                updated_jobs += 1
    finally:
        await conn.close()

    return {
        "new_jobs": new_jobs,
        "updated_jobs": updated_jobs,
        "skipped": skipped,
        "total_processed": len(all_jobs),
        "failed_companies": failed,
        "companies": summary,
    }


class SetAtsRequest(BaseModel):
    name: str
    ats_type: str
    slug: str


@router.post("/companies/set-ats")
async def set_company_ats(req: SetAtsRequest):
    rows = []
    updated = False
    try:
        with open(CSV_PATH, newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            fieldnames = list(reader.fieldnames or [])
            for row in reader:
                if row.get('name') == req.name:
                    row['ats_type'] = req.ats_type
                    row['slug'] = req.slug
                    updated = True
                rows.append(row)
    except FileNotFoundError:
        return JSONResponse(status_code=404, content={"error": "companies.csv not found"})

    if not updated:
        return JSONResponse(status_code=404, content={"error": f"Company '{req.name}' not found"})

    with open(CSV_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return {"success": True, "name": req.name, "ats_type": req.ats_type, "slug": req.slug}
