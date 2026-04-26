import csv
import os

import asyncpg
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ats_discovery import auto_discover_israeli_companies
from company_discovery import CSV_PATH, discover_all_companies, discover_one_company
from company_scraper import is_israeli_job
from embedder import embed
from scraper import scrape_israel_jobs

router = APIRouter()


@router.post("/scrape-and-store")
async def scrape_and_store():
    jobs = await scrape_israel_jobs()
    if not jobs:
        return {"new_jobs": 0, "total_processed": 0}

    jobs = [
        j for j in jobs
        if is_israeli_job({'location': j.get('location', '') or j.get('job_location', '')})
    ]

    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    new_jobs = 0
    updated_jobs = 0
    try:
        for job in jobs:
            if not (job.get("description") or "").strip():
                continue  # never store jobs without a description
            embed_text = f"{job['title']} {job['description'][:500]}"
            embedding = embed(embed_text)
            embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

            row = await conn.fetchrow(
                """
                INSERT INTO "Job" (id, title, company, description, location,
                                   url, source, salary_min, salary_max,
                                   embedding, scraped_at)
                VALUES (gen_random_uuid(), $1, $2, $3, $4,
                        $5, $6, $7, $8,
                        $9::vector, now())
                ON CONFLICT (url) DO UPDATE
                    SET description = EXCLUDED.description,
                        embedding    = EXCLUDED.embedding,
                        scraped_at   = now()
                    WHERE length("Job".description) < 100
                RETURNING (xmax = 0) AS is_insert
                """,
                job["title"],
                job["company"],
                job["description"],
                job["location"],
                job["url"],
                job["source"],
                job["salary_min"],
                job["salary_max"],
                embedding_str,
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
    print(f"Israel filter (route): {jobs_before} → {len(jobs)} jobs")

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
            embed_text = f"{job['title']} {job.get('description', '')[:500]}".strip()
            embedding = embed(embed_text)
            embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

            row = await conn.fetchrow(
                """
                INSERT INTO "Job" (id, title, company, description, location,
                                   url, source, salary_min, salary_max,
                                   embedding, scraped_at)
                VALUES (gen_random_uuid(), $1, $2, $3, $4,
                        $5, $6, $7, $8,
                        $9::vector, now())
                ON CONFLICT (url) DO UPDATE
                    SET description = EXCLUDED.description,
                        embedding    = EXCLUDED.embedding,
                        scraped_at   = now()
                    WHERE length("Job".description) < 100
                RETURNING (xmax = 0) AS is_insert
                """,
                job["title"],
                job["company"],
                job.get("description", ""),
                job.get("location", ""),
                job["url"],
                job["source"],
                job.get("salary_min"),
                job.get("salary_max"),
                embedding_str,
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
