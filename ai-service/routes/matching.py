import json
import os
import asyncpg
import anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
_client = anthropic.Anthropic()


class MatchRequest(BaseModel):
    user_id: str


@router.post("/match-jobs")
async def match_jobs(req: MatchRequest):
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)

    try:
        # Step A — vector search (no LLM)
        rows = await conn.fetch(
            """
            SELECT j.id, j.title, j.company, j.description,
                   j.location, j.url, j.salary_min, j.salary_max,
                   1 - (j.embedding <=> cv.embedding::vector) AS similarity
            FROM "Job" j, "CV" cv
            WHERE cv.user_id = $1
              AND j.scraped_at > NOW() - INTERVAL '48 hours'
              AND j.id NOT IN (
                SELECT job_id FROM "UserJobInteraction" WHERE user_id = $1
              )
              AND 1 - (j.embedding <=> cv.embedding::vector) > 0.60
            ORDER BY j.embedding <=> cv.embedding::vector
            LIMIT 50
            """,
            req.user_id,
        )

        if not rows:
            return []

        # Fetch CV summary and skills for the prompt
        cv_row = await conn.fetchrow(
            'SELECT clean_summary, skills_json FROM "CV" WHERE user_id = $1',
            req.user_id,
        )
    finally:
        await conn.close()

    if not cv_row:
        raise HTTPException(status_code=404, detail="CV not found for user")

    clean_summary = cv_row["clean_summary"] or ""
    skills_json = cv_row["skills_json"] or {}
    if isinstance(skills_json, str):
        skills_json = json.loads(skills_json)
    skills_list = ", ".join(skills_json.get("skills", []))

    jobs = [dict(r) for r in rows]

    # Step B — Claude batch scoring (ONE call for all jobs)
    jobs_text = "\n".join(
        f'JOB_ID:{j["id"]} | {j["title"]} at {j["company"]} | {(j["description"] or "")[:200]}'
        for j in jobs
    )

    prompt = (
        "You are a job matching assistant. Score each job for this candidate.\n"
        "Return ONLY a JSON array. No markdown, no explanation.\n"
        'Format: [{"job_id":"...","score":85,"reasons":["r1","r2"],"gaps":["g1"]}]\n\n'
        f"Candidate: {clean_summary}\n"
        f"Skills: {skills_list}\n\n"
        f"Jobs:\n{jobs_text}"
    )

    message = _client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    try:
        scores = json.loads(raw)
    except json.JSONDecodeError:
        # Fall back to vector-only results if Claude returns bad JSON
        scores = []

    # Merge scores onto vector results
    score_map = {s["job_id"]: s for s in scores}
    for job in jobs:
        scored = score_map.get(job["id"], {})
        job["claude_score"] = scored.get("score", 0)
        job["reasons"] = scored.get("reasons", [])
        job["gaps"] = scored.get("gaps", [])
        job["similarity"] = float(job["similarity"])

    # Sort by Claude score, return top 20
    jobs.sort(key=lambda j: j["claude_score"], reverse=True)
    return jobs[:20]
