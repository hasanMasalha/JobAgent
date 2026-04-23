import os

import asyncpg
from fastapi import APIRouter

from embedder import embed
from scraper import scrape_israel_jobs

router = APIRouter()


@router.post("/scrape-and-store")
async def scrape_and_store():
    jobs = await scrape_israel_jobs()
    if not jobs:
        return {"new_jobs": 0, "total_processed": 0}

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
