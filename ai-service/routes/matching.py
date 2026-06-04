import json
import os
import re
import sys

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


# ── seniority helpers ─────────────────────────────────────────────────────────

def _extract_years_experience(cv_text: str) -> int:
    """Extract years of experience from CV text."""
    patterns = [
        r'(\d+)\+?\s*years?\s*(?:of\s*)?experience',
        r'(\d+)\+?\s*years?\s*in\s*(?:software|backend|development)',
        r'experience\s*(?:of\s*)?(\d+)\+?\s*years?',
    ]
    found = []
    for pattern in patterns:
        for m in re.findall(pattern, cv_text.lower()):
            if str(m).isdigit():
                found.append(int(m))
    if found:
        return max(found)

    # Fallback: sum years from date ranges in work history
    date_matches = re.findall(r'20(\d{2})\s*[-–]\s*(?:20(\d{2})|present|current)', cv_text.lower())
    total = 0
    for match in date_matches:
        start = 2000 + int(match[0])
        end = 2000 + int(match[1]) if match[1] else 2026
        total += max(0, end - start)
    if total > 0:
        return min(total, 30)
    return 1  # default: assume entry level


def _get_candidate_seniority(cv_data: dict) -> dict:
    """Determine candidate seniority level from CV data."""
    years = int(cv_data.get("years_experience", 0) or 0)

    if years <= 1:
        return {
            "years": years,
            "level": "junior",
            "label": "Junior (0-1 years)",
            "ideal_titles": ["junior", "entry", "associate", "graduate", "trainee"],
            "avoid_titles": ["senior", "lead", "principal", "staff", "architect",
                             "head", "director", "manager", "vp"],
            "max_required_years": 2,
        }
    if years <= 3:
        return {
            "years": years,
            "level": "mid",
            "label": "Mid-level (2-3 years)",
            "ideal_titles": ["engineer", "developer", "software engineer",
                             "backend", "fullstack", "frontend"],
            "avoid_titles": ["senior", "lead", "principal", "staff", "architect",
                             "head", "director", "manager", "vp",
                             "junior", "entry", "graduate"],
            "max_required_years": 4,
        }
    if years <= 6:
        return {
            "years": years,
            "level": "senior",
            "label": "Senior (4-6 years)",
            "ideal_titles": ["senior", "engineer", "developer", "lead", "tech lead"],
            "avoid_titles": ["principal", "staff", "architect", "head of",
                             "director", "vp", "junior", "entry", "graduate",
                             "intern", "trainee"],
            "max_required_years": 7,
        }
    if years <= 10:
        return {
            "years": years,
            "level": "staff",
            "label": "Staff/Lead (7-10 years)",
            "ideal_titles": ["staff", "lead", "principal", "senior",
                             "architect", "tech lead"],
            "avoid_titles": ["director", "vp", "cto", "junior", "entry",
                             "graduate", "intern", "trainee", "associate"],
            "max_required_years": 12,
        }
    return {
        "years": years,
        "level": "principal",
        "label": "Principal/Architect (10+ years)",
        "ideal_titles": ["principal", "architect", "staff", "distinguished",
                         "fellow", "director", "vp engineering"],
        "avoid_titles": ["junior", "entry", "graduate", "intern",
                         "trainee", "associate"],
        "max_required_years": 999,
    }


def _get_job_required_years(title: str, description: str) -> int:
    """Extract required years of experience from job title and description."""
    text = f"{title} {description}".lower()
    patterns = [
        r'(\d+)\+\s*years?\s*(?:of\s*)?experience',
        r'(\d+)\s*-\s*\d+\s*years?\s*(?:of\s*)?experience',
        r'at\s*least\s*(\d+)\s*years?',
        r'minimum\s*(?:of\s*)?(\d+)\s*years?',
        r'(\d+)\s*years?\s*(?:of\s*)?(?:professional\s*)?experience',
        r'(\d+)\s*שנות\s*ניסיון',
        r'(\d+)\+\s*שנות',
        r'לפחות\s*(\d+)\s*שנ',
    ]
    found = []
    for pattern in patterns:
        for match in re.findall(pattern, text):
            try:
                found.append(int(match))
            except ValueError:
                pass
    if found:
        return min(found)

    title_lower = title.lower()
    if any(w in title_lower for w in ['principal', 'distinguished', 'fellow', 'architect', 'vp', 'director']):
        return 10
    if any(w in title_lower for w in ['staff', 'lead', 'tech lead', 'team lead']):
        return 7
    if any(w in title_lower for w in ['senior', 'sr.']):
        return 5
    if any(w in title_lower for w in ['mid', 'medior', 'intermediate']):
        return 3
    if any(w in title_lower for w in ['junior', 'jr.', 'entry', 'associate', 'graduate', 'intern', 'trainee']):
        return 0
    return 2


def _experience_match_adjustment(candidate_years: int, job_required_years: int) -> tuple[int, str]:
    """Returns (score_adjustment, reason). Positive = bonus, Negative = penalty."""
    diff = candidate_years - job_required_years
    if -1 <= diff <= 2:
        return (10, "Experience level is a strong match")
    if -3 <= diff < -1:
        return (-15, f"Candidate has {candidate_years}y, job wants {job_required_years}y — slightly under but achievable")
    if -5 <= diff < -3:
        return (-30, f"Candidate has {candidate_years}y, job wants {job_required_years}y — significant experience gap")
    if diff < -5:
        return (-50, f"Candidate has {candidate_years}y, job wants {job_required_years}y — very large experience gap, unlikely to hire")
    if 3 <= diff <= 5:
        return (-10, "Candidate may be overqualified — role may not be challenging enough")
    if diff > 5:
        return (-20, "Candidate likely overqualified — may not accept or get rejected as overqualified")
    return (0, "Experience level acceptable")


# ── cache helpers ─────────────────────────────────────────────────────────────

async def _get_db_cache(conn, user_id: str) -> list | None:
    try:
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
    except Exception as e:
        print(f"[matching] cache read failed (non-fatal): {e}", file=sys.stderr)
        return None


async def _set_db_cache(conn, user_id: str, results: list) -> None:
    try:
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
    except Exception as e:
        print(f"[matching] cache write failed (non-fatal): {e}", file=sys.stderr)


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

async def _vector_search(conn, user_id: str, seniority: dict | None = None) -> list:
    # Build seniority-aware ORDER BY — terms are hardcoded, no injection risk
    if seniority:
        boost_terms = seniority["ideal_titles"]
        avoid_terms = seniority["avoid_titles"]
        boost_conds = " OR ".join(f"LOWER(j.title) LIKE '%{t}%'" for t in boost_terms)
        avoid_conds = " OR ".join(f"LOWER(j.title) LIKE '%{t}%'" for t in avoid_terms)
        order_expr = f"""
            CASE
                WHEN {boost_conds}
                    THEN (1 - (j.embedding <=> cv.embedding::vector)) * 1.3
                WHEN {avoid_conds}
                    THEN (1 - (j.embedding <=> cv.embedding::vector)) * 0.4
                ELSE (1 - (j.embedding <=> cv.embedding::vector))
            END DESC
        """
    else:
        order_expr = "j.embedding <=> cv.embedding::vector ASC"

    rows = await conn.fetch(
        f"""
        SELECT j.id, j.title, j.company, j.description,
               j.location, j.url, j.source, j.salary_min, j.salary_max,
               j.scraped_at, j.apply_type,
               1 - (j.embedding <=> cv.embedding::vector) AS similarity
        FROM "Job" j, "CV" cv
        WHERE cv.user_id = $1
          AND j.scraped_at > NOW() - INTERVAL '30 days'
          AND j.id NOT IN (
            SELECT job_id FROM "UserJobInteraction" WHERE user_id = $1
          )
          AND j.id NOT IN (
            SELECT job_id FROM "Application" WHERE user_id = $1
          )
          AND 1 - (j.embedding <=> cv.embedding::vector) > 0.50
        ORDER BY {order_expr}
        LIMIT 200
        """,
        user_id,
    )

    result = []
    for r in rows:
        d = dict(r)
        if hasattr(d.get("scraped_at"), "isoformat"):
            d["scraped_at"] = d["scraped_at"].isoformat()
        result.append(d)
    return result


# ── Claude scoring (slow, enriches results) ───────────────────────────────────

def _run_claude_scoring(jobs: list, cv_data: dict) -> list:
    candidate_info = _get_candidate_seniority(cv_data)

    jobs_text = "\n".join(
        f'{j["id"]} | {j["title"]} at {j["company"]} '
        f'(req: ~{_get_job_required_years(j["title"], j.get("description") or "")}y) | '
        f'{(j.get("description") or "")[:200]}'
        for j in jobs
    )

    prompt = f"""You are an expert technical recruiter scoring job matches.
Score each job from 0-100 based on realistic hire probability.

CANDIDATE PROFILE:
Name/Role: {cv_data.get('current_role', 'Software Engineer')}
Years of experience: {cv_data.get('years_experience', 0)}
Seniority level: {candidate_info['label']}
Core skills: {', '.join(cv_data.get('skills', [])[:15])}
Education: {cv_data.get('education', '')}

SCORING RULES — FOLLOW STRICTLY:

1. EXPERIENCE LEVEL MATCH (40% of score):
   This is the most important factor.

   Candidate has {cv_data.get('years_experience', 0)} years.

   Scoring guide for experience match:
   - Job requires ≤ candidate_years + 1 year → 35-40 points
   - Job requires candidate_years + 2-3 years → 20-30 points
   - Job requires candidate_years + 4-5 years → 10-20 points
   - Job requires candidate_years + 6+ years → 0-10 points
   - Job requires 3+ years LESS than candidate → 20-30 points
     (candidate may be overqualified)

   Title keywords that indicate seniority:
   - "Junior/Entry/Associate/Graduate" → 0-2 years expected
   - "Mid/Medior/Intermediate" → 2-4 years expected
   - "Senior/Sr." → 4-7 years expected
   - "Staff/Lead/Tech Lead" → 7-10 years expected
   - "Principal/Architect/Distinguished" → 10+ years expected

2. SKILLS MATCH (40% of score):
   - Core skills match (must-have requirements) → up to 30 pts
   - Bonus skills match (nice-to-have) → up to 10 pts
   - Missing must-have skills → subtract proportionally

3. DOMAIN/CONTEXT FIT (20% of score):
   - Industry fit, company stage, role responsibilities
   - Culture and work style indicators

FINAL SCORE INTERPRETATION:
- 85-100: Exceptional match, very likely to get interview
- 70-84: Strong match, good chance of interview
- 55-69: Decent match, worth applying
- 40-54: Weak match, long shot
- 0-39: Poor match, do not recommend applying

CRITICAL RULES:
- A senior role (5+ years) for a junior (1 year) candidate MUST score below 45
- A junior role for a senior candidate (7+ years) MUST score below 50 (overqualified concern)
- Skills alone cannot overcome a large experience gap
- Be realistic — score as a real recruiter would

JOBS TO SCORE (format: id | title at company (req: Ny) | description snippet):
{jobs_text}

Return ONLY a JSON array. Each object must have:
- job_id: string
- score: integer 0-100
- reasons: array of 2-3 strings (why it fits)
- gaps: array of 1-3 strings (what's missing or risky)
- experience_match: string (one of: "perfect", "slightly_under", "significantly_under", "severely_under", "overqualified", "acceptable")
"""

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
                applied = await conn.fetch(
                    'SELECT job_id FROM "Application" WHERE user_id = $1',
                    req.user_id,
                )
                excluded_ids = {r["job_id"] for r in dismissed} | {r["job_id"] for r in applied}
                return [j for j in cached if j["id"] not in excluded_ids]

        # 2. Fetch CV data first — needed to build seniority for ordering
        cv_row = await conn.fetchrow(
            'SELECT clean_summary, skills_json FROM "CV" WHERE user_id = $1',
            req.user_id,
        )
        if not cv_row:
            raise HTTPException(status_code=404, detail="CV not found for user")

        skills_json = cv_row["skills_json"] or {}
        if isinstance(skills_json, str):
            skills_json = json.loads(skills_json)

        years_exp = int(skills_json.get("years_experience") or 0)
        if years_exp == 0 and cv_row.get("clean_summary"):
            years_exp = _extract_years_experience(cv_row["clean_summary"])

        cv_data = {
            "clean_summary": cv_row["clean_summary"] or "",
            "skills": skills_json.get("skills", []),
            "years_experience": years_exp,
            "education": skills_json.get("education", ""),
            "current_role": skills_json.get("current_role", ""),
        }
        seniority = _get_candidate_seniority(cv_data)

        # 3. Vector search with seniority-aware title boosting/penalising
        jobs = await _vector_search(conn, req.user_id, seniority)
        if not jobs:
            return []

        # 4. Claude scoring — top 20 only (cost control); rest get vector-only scores
        jobs_to_score = jobs[:20]
        remaining = jobs[20:]
        scores = _run_claude_scoring(jobs_to_score, cv_data)
        if scores:
            scored_results = _merge_scores(jobs_to_score, scores)
        else:
            scored_results = _vector_only(jobs_to_score)

        vector_tail = _vector_only(remaining)
        results = scored_results + vector_tail

        # 5. Persist to DB cache (all jobs, so pagination works)
        await _set_db_cache(conn, req.user_id, results)

    finally:
        await conn.close()

    return results
