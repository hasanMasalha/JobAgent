"""Every intake run, kept in the database ("IntakeRun"), and what went wrong.

From 2026-10-20 to 2026-11-25 the daily pipeline stored nothing and nobody
noticed. The AI service answered requests all along, but no source stored or
even refreshed a job. By 2 November cleanup had deactivated every job, so for
three weeks matching had nothing to match. The container logs that would have
shown why went with the next deploy. The likeliest cause: the 20 October run
hung, with no time limit, and with max_instances=1 APScheduler skipped every
05:00 after it.

So each run writes its own record here (one row; each step adds its result
to `steps`), and `problems` lists what an operator must hear about. The
Next.js route /api/admin/intake-health reads this table, emails the alert
(Resend, ALERT_EMAIL) and is also called from GitHub every 6 h, so a run
that never happens is noticed too. That check can't live in this process:
a dead scheduler can't report itself.

Writing history never breaks intake: each call opens its own connection and
logs and swallows any error (a missing table included — the route reports
that one).
"""
import json
import logging
import os
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)

# The same DDL as prisma/migrations/20261126_add_intake_runs (IF NOT EXISTS,
# so either can come first).
_DDL = """
CREATE TABLE IF NOT EXISTS "IntakeRun" (
    "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "kind"        TEXT NOT NULL,
    "trigger"     TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'running',
    "started_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "finished_at" TIMESTAMPTZ,
    "jobs_stored" INTEGER,
    "steps"       JSONB NOT NULL DEFAULT '{}'::jsonb,
    "problems"    JSONB NOT NULL DEFAULT '[]'::jsonb,
    "error"       TEXT
);
CREATE INDEX IF NOT EXISTS "IntakeRun_kind_started_at_idx" ON "IntakeRun" ("kind", "started_at" DESC);
"""

_table_ready = False


async def _conn() -> asyncpg.Connection:
    global _table_ready
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    if not _table_ready:
        await conn.execute(_DDL)
        _table_ready = True
    return conn


async def start_run(kind: str, trigger: str) -> str | None:
    """A new row in state running; its id, or None if it couldn't be written."""
    try:
        conn = await _conn()
        try:
            return await conn.fetchval(
                'INSERT INTO "IntakeRun" (kind, trigger) VALUES ($1, $2) RETURNING id', kind, trigger
            )
        finally:
            await conn.close()
    except Exception:
        logger.exception("[intake-history] couldn't record the start of a %s run", kind)
        return None


async def record_step(run_id: str | None, name: str, data: dict) -> None:
    if not run_id:
        return
    try:
        conn = await _conn()
        try:
            await conn.execute(
                'UPDATE "IntakeRun" SET steps = steps || jsonb_build_object($2::text, $3::jsonb) WHERE id = $1',
                run_id, name, json.dumps(data, default=str),
            )
        finally:
            await conn.close()
    except Exception:
        logger.exception("[intake-history] couldn't record step %s of run %s", name, run_id)


async def finish_run(
    run_id: str | None, *, jobs_stored: int, problems: list[str], error: str | None = None
) -> None:
    if not run_id:
        return
    status = "failed" if error else ("problems" if problems else "ok")
    try:
        conn = await _conn()
        try:
            await conn.execute(
                'UPDATE "IntakeRun" SET status = $2, finished_at = now(), jobs_stored = $3, '
                "problems = $4::jsonb, error = $5 WHERE id = $1",
                run_id, status, jobs_stored, json.dumps(problems), error,
            )
        finally:
            await conn.close()
    except Exception:
        logger.exception("[intake-history] couldn't record the end of run %s", run_id)


# ── what each step stored, and what's wrong with it ──────────────────────────

def stored_by(name: str, result: Any) -> int:
    """Jobs a step wrote (inserted or refreshed)."""
    if not isinstance(result, dict):
        return 0
    if name == "scrape":
        return int(result.get("new_jobs") or 0) + int(result.get("updated_jobs") or 0)
    if name == "active_jobs":
        return int(result.get("new") or 0) + int(result.get("updated") or 0)
    if name == "arbeitnow":
        return int(result.get("new") or 0)
    return 0


def step_problems(name: str, data: dict) -> list[str]:
    """What an operator must hear about one step's outcome (`data` as the
    pipeline records it: status, error, result)."""
    label = {
        "scrape": "Scrape (LinkedIn, Indeed, boards, career pages)",
        "active_jobs": "Active Jobs DB",
        "arbeitnow": "Arbeitnow",
        "match": "Matching",
    }.get(name, name)
    status = data.get("status")
    if status == "timed_out":
        return [f"{label} timed out after {data.get('timeout_s', 0) / 3600:g} h and was cancelled"]
    if status == "cancelled":
        return [f"{label} was cancelled (service shutdown or restart)"]
    if status == "failed":
        return [f"{label} failed: {data.get('error') or 'unknown error'}"]
    result = data.get("result") or {}
    problems = []
    if name == "active_jobs":
        errors = result.get("api_errors") or []
        markets = result.get("by_market") or {}
        if errors and len(errors) >= len(markets):
            problems.append(f"{label}: the API refused every market ({', '.join(errors)}) — see the AI service log")
        elif result.get("error"):
            problems.append(f"{label}: {result['error']}")
    if name == "match" and result.get("failed"):
        problems.append(f"{label} failed for {result['failed']} of {result.get('users', '?')} user(s)")
    return problems


def summary(result: Any) -> Any:
    """A step's result without the bulky timing report."""
    if isinstance(result, dict):
        return {k: v for k, v in result.items() if k != "timing"}
    return result
