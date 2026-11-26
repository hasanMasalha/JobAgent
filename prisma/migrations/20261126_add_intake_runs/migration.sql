-- Intake run history (ai-service/intake_history.py) and the alerts sent about
-- it (/api/admin/intake-health). IF NOT EXISTS: the AI service and the route
-- create the same tables on first use, so this and a deploy can come in
-- either order.
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

CREATE TABLE IF NOT EXISTS "IntakeAlert" (
    "key"     TEXT PRIMARY KEY,
    "sent_at" TIMESTAMPTZ NOT NULL,
    "message" TEXT NOT NULL
);
