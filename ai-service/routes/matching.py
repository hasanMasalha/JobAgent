import json
import os

import anthropic
import asyncpg
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
        LIMIT 50
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

def _run_claude_scoring(jobs: list, cv_data: dict) -> list:
    jobs_text = "\n".join(
        f'{j["id"]} | {j["title"]} at {j["company"]} | {(j["description"] or "")[:200]}'
        for j in jobs
    )
    prompt = f"""You are a strict job matching assistant for a recruiter.
Score how well each job fits this candidate.

CANDIDATE PROFILE:
{cv_data['clean_summary']}
Skills: {', '.join(cv_data['skills'])}
Experience: {cv_data['years_experience']} years total

SCORING RULES — follow these strictly:

1. START with a base score of 70 if skills overlap significantly

2. INCREASE score for:
   +15 if candidate meets or exceeds required years of experience
   +10 if candidate has direct experience with main tech stack
   +5  if location/remote preference matches

3. DECREASE score for:
   -25 if job requires 4+ years and candidate has under 2 years
   -20 if job requires 3+ years and candidate has under 1 year
   -15 if job requires senior/lead/principal title explicitly
   -15 if job requires specific certification candidate lacks
   -10 if tech stack is mostly unfamiliar (under 30% overlap)
   -5  if job is a completely different domain (e.g. CV is backend, job is mobile)

4. HARD CAPS:
   - If job says "5+ years" or "senior" and candidate has under 2 years:
     MAXIMUM score is 45 regardless of skill match
   - If job says "4+ years" and candidate has under 2 years:
     MAXIMUM score is 55 regardless of skill match
   - If job says "junior" or "entry level":
     MINIMUM score is 60 if skills match

5. SET score to 0 if:
   - Job requires specific license or clearance candidate doesn't have
   - Job is clearly non-technical (sales, HR) and CV is technical

Return ONLY valid JSON array, no explanation:
[{{
  "job_id": "...",
  "score": 45,
  "reasons": ["skill overlap with Python/FastAPI", "TypeScript mentioned"],
  "gaps": ["needs 4+ years, candidate has ~1 year", "no AWS production experience"],
  "experience_match": "junior applying to senior role"
}}]

CANDIDATE: {cv_data['years_experience']} years experience
JOBS TO SCORE:
{jobs_text}"""
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
        job["experience_match"] = scored.get("experience_match", "")
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
                dismissed = await conn.fetch(
                    'SELECT job_id FROM "UserJobInteraction" WHERE user_id = $1',
                    req.user_id,
                )
                dismissed_ids = {r["job_id"] for r in dismissed}
                return [j for j in cached if j["id"] not in dismissed_ids]

        # 2. Vector search
        jobs, cv_row = await _vector_search(conn, req.user_id)
        if not jobs:
            return []
        if not cv_row:
            raise HTTPException(status_code=404, detail="CV not found for user")

        skills_json = cv_row["skills_json"] or {}
        if isinstance(skills_json, str):
            skills_json = json.loads(skills_json)
        cv_data = {
            "clean_summary": cv_row["clean_summary"] or "",
            "skills": skills_json.get("skills", []),
            "years_experience": int(skills_json.get("years_experience") or 0),
        }

        # 3. Claude scoring
        scores = _run_claude_scoring(jobs, cv_data)
        if scores:
            results = _merge_scores(jobs, scores)
        else:
            results = _vector_only(jobs)

        # 4. Persist to DB cache
        await _set_db_cache(conn, req.user_id, results)

    finally:
        await conn.close()

    return results
