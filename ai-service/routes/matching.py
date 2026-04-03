import json
import os
import asyncpg
import anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
_client = anthropic.Anthropic()

CACHE_TTL_HOURS = 6


class MatchRequest(BaseModel):
    user_id: str
    force_refresh: bool = False


# ── cache helpers (stored in Postgres, survives restarts) ─────────────────────

async def _get_db_cache(conn, user_id: str) -> list | None:
    row = await conn.fetchrow(
        """
        SELECT results_json FROM match_cache
        WHERE user_id = $1
          AND computed_at > NOW() - INTERVAL '6 hours'
        """,
        user_id,
    )
    if row:
        return json.loads(row["results_json"])
    return None


async def _set_db_cache(conn, user_id: str, results: list) -> None:
    await conn.execute(
        """
        INSERT INTO match_cache (user_id, results_json, computed_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET results_json = EXCLUDED.results_json,
              computed_at  = EXCLUDED.computed_at
        """,
        user_id,
        json.dumps(results),
    )


async def _ensure_cache_table(conn) -> None:
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS match_cache (
            user_id     TEXT PRIMARY KEY,
            results_json TEXT NOT NULL,
            computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


# ── vector search (fast, no LLM) ──────────────────────────────────────────────

async def _vector_search(conn, user_id: str) -> tuple[list, dict | None]:
    rows = await conn.fetch(
        """
        SELECT j.id, j.title, j.company, j.description,
               j.location, j.url, j.salary_min, j.salary_max,
               j.scraped_at,
               1 - (j.embedding <=> cv.embedding::vector) AS similarity
        FROM "Job" j, "CV" cv
        WHERE cv.user_id = $1
          AND j.scraped_at > NOW() - INTERVAL '7 days'
          AND j.id NOT IN (
            SELECT job_id FROM "UserJobInteraction" WHERE user_id = $1
          )
          AND 1 - (j.embedding <=> cv.embedding::vector) > 0.50
        ORDER BY j.embedding <=> cv.embedding::vector
        LIMIT 20
        """,
        user_id,
    )
    cv_row = await conn.fetchrow(
        'SELECT clean_summary, skills_json FROM "CV" WHERE user_id = $1',
        user_id,
    )
    result = []
    for r in rows:
        d = dict(r)
        if hasattr(d.get("scraped_at"), "isoformat"):
            d["scraped_at"] = d["scraped_at"].isoformat()
        result.append(d)
    return result, cv_row


# ── Claude scoring (slow, enriches results) ───────────────────────────────────

def _run_claude_scoring(jobs: list, clean_summary: str, skills_list: str, years_experience: int) -> list:
    if years_experience <= 1:
        seniority = "junior (0-1 years experience)"
    elif years_experience <= 3:
        seniority = "junior-mid (2-3 years experience)"
    elif years_experience <= 6:
        seniority = "mid-level (4-6 years experience)"
    else:
        seniority = "senior (7+ years experience)"

    jobs_text = "\n".join(
        f'{j["id"]} | {j["title"]} at {j["company"]} | {(j["description"] or "")[:200]}'
        for j in jobs
    )
    prompt = (
        "You are a job matching assistant. Score each job 0-100 for this candidate.\n"
        "Return ONLY a JSON array. No markdown, no explanation.\n"
        'Format: [{"job_id":"<exact id from input>","score":85,"reasons":["r1","r2"],"gaps":["g1"]}]\n\n'
        f"Candidate level: {seniority}\n"
        f"Candidate summary: {clean_summary}\n"
        f"Skills: {skills_list}\n\n"
        "Scoring rules:\n"
        "- Penalise HEAVILY (score below 30) if the job requires significantly more experience than the candidate has.\n"
        "- A junior candidate should score low on roles labelled Senior, Lead, Staff, Principal, or requiring 5+ years.\n"
        "- A senior candidate should score low on roles labelled Junior or entry-level.\n"
        "- Skills match is important but seniority fit is the primary filter.\n\n"
        f"Jobs (id | title | description):\n{jobs_text}"
    )
    message = _client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        last_brace = raw.rfind("}")
        if last_brace != -1:
            try:
                return json.loads(raw[: last_brace + 1] + "]")
            except json.JSONDecodeError:
                pass
    return []


def _merge_scores(jobs: list, scores: list) -> list:
    score_map = {s["job_id"]: s for s in scores}
    for job in jobs:
        scored = score_map.get(job["id"], {})
        job["claude_score"] = scored.get("score", 0)
        job["reasons"] = scored.get("reasons", [])
        job["gaps"] = scored.get("gaps", [])
        job["similarity"] = float(job["similarity"])
    jobs.sort(key=lambda j: j["claude_score"], reverse=True)
    return jobs


def _vector_only(jobs: list) -> list:
    """Return jobs ranked by vector similarity only (no Claude)."""
    for job in jobs:
        job["claude_score"] = 0
        job["reasons"] = []
        job["gaps"] = []
        job["similarity"] = float(job["similarity"])
    jobs.sort(key=lambda j: j["similarity"], reverse=True)
    return jobs


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/match-debug")
async def match_debug(user_id: str):
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)
    try:
        cv_row = await conn.fetchrow(
            'SELECT user_id, length(clean_summary) as summary_len, embedding IS NOT NULL as has_embedding FROM "CV" WHERE user_id = $1',
            user_id,
        )
        total_jobs = await conn.fetchval('SELECT COUNT(*) FROM "Job"')
        recent_jobs = await conn.fetchval(
            "SELECT COUNT(*) FROM \"Job\" WHERE scraped_at > NOW() - INTERVAL '7 days'"
        )
        jobs_with_embeddings = await conn.fetchval(
            "SELECT COUNT(*) FROM \"Job\" WHERE embedding IS NOT NULL AND scraped_at > NOW() - INTERVAL '7 days'"
        )
        seen_jobs = await conn.fetchval(
            'SELECT COUNT(*) FROM "UserJobInteraction" WHERE user_id = $1',
            user_id,
        )
    finally:
        await conn.close()

    return {
        "cv": dict(cv_row) if cv_row else None,
        "total_jobs_in_db": total_jobs,
        "recent_jobs_last_7d": recent_jobs,
        "recent_jobs_with_embeddings": jobs_with_embeddings,
        "seen_jobs_excluded": seen_jobs,
    }


@router.post("/match-jobs")
async def match_jobs(req: MatchRequest):
    database_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(database_url)
    try:
        await _ensure_cache_table(conn)

        # 1. Return DB cache if fresh and not a forced refresh
        if not req.force_refresh:
            cached = await _get_db_cache(conn, req.user_id)
            if cached is not None:
                return cached

        # 2. Vector search
        jobs, cv_row = await _vector_search(conn, req.user_id)
        if not jobs:
            return []
        if not cv_row:
            raise HTTPException(status_code=404, detail="CV not found for user")

        skills_json = cv_row["skills_json"] or {}
        if isinstance(skills_json, str):
            skills_json = json.loads(skills_json)
        clean_summary = cv_row["clean_summary"] or ""
        skills_list = ", ".join(skills_json.get("skills", []))
        years_experience = int(skills_json.get("years_experience") or 0)

        # 3. Claude scoring
        scores = _run_claude_scoring(jobs, clean_summary, skills_list, years_experience)
        if scores:
            results = _merge_scores(jobs, scores)
        else:
            results = _vector_only(jobs)

        # 4. Persist to DB cache
        await _set_db_cache(conn, req.user_id, results)

    finally:
        await conn.close()

    return results
