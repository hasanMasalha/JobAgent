import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendIntakeAlert } from "@/lib/email";
import { isInternalRequest } from "@/lib/internal-auth";
import { evaluateIntake, findingsToSend, type IntakeRun } from "@/lib/intake-health";

// Job intake health (lib/intake-health.ts), emailed to ALERT_EMAIL.
// Called by the AI service right after each daily run (X-Internal-Key) and
// every 6 h by the Intake health workflow (x-api-key). The workflow fails while
// `healthy` is false, so GitHub's own failure email is a second channel. It
// also fails if this route can't be reached, the email can't be sent, or
// ALERT_EMAIL is unset.
//
//   curl -X POST https://jobagent.uk/api/admin/intake-health -H "x-api-key: <INTERNAL_API_KEY>"

export const dynamic = "force-dynamic";

// Same DDL as prisma/migrations/20261126_add_intake_runs and
// ai-service/intake_history.py; IF NOT EXISTS so whichever runs first wins.
const DDL = [
  `CREATE TABLE IF NOT EXISTS "IntakeRun" (
    "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "kind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "finished_at" TIMESTAMPTZ,
    "jobs_stored" INTEGER,
    "steps" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "problems" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "error" TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS "IntakeRun_kind_started_at_idx" ON "IntakeRun" ("kind", "started_at" DESC)`,
  `CREATE TABLE IF NOT EXISTS "IntakeAlert" (
    "key" TEXT PRIMARY KEY,
    "sent_at" TIMESTAMPTZ NOT NULL,
    "message" TEXT NOT NULL
  )`,
];

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req) && !isInternalRequest(req, "x-api-key")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  for (const sql of DDL) await db.$executeRawUnsafe(sql);

  const runs = await db.$queryRaw<IntakeRun[]>`
    SELECT id, kind, trigger, status, started_at, finished_at, jobs_stored, problems
    FROM "IntakeRun"
    WHERE started_at > now() - interval '7 days'
    ORDER BY started_at DESC
  `;
  const findings = evaluateIntake(runs, now);

  const sentRows = await db.$queryRaw<{ key: string; sent_at: Date }[]>`
    SELECT key, sent_at FROM "IntakeAlert"
  `;
  const toSend = findingsToSend(findings, new Map(sentRows.map((r) => [r.key, r.sent_at])), now);

  const to = process.env.ALERT_EMAIL;
  let emailed = 0;
  // Unset is unhealthy even when nothing is wrong: the first real alert would
  // go nowhere.
  let emailError: string | null = to ? null : "ALERT_EMAIL is not set";
  if (toSend.length && to) {
    try {
      await sendIntakeAlert({ to, messages: toSend.map((f) => f.message) });
      emailed = toSend.length;
      for (const f of toSend) {
        await db.$executeRaw`
          INSERT INTO "IntakeAlert" (key, sent_at, message) VALUES (${f.key}, ${now}, ${f.message})
          ON CONFLICT (key) DO UPDATE SET sent_at = EXCLUDED.sent_at, message = EXCLUDED.message
        `;
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
      console.error("[intake-health] alert email failed:", emailError);
    }
  }

  const latest = runs.find((r) => r.kind === "daily") ?? null;
  return NextResponse.json({
    healthy: findings.length === 0 && !emailError,
    problems: findings.map((f) => f.message),
    emailed,
    emailError,
    latestDaily: latest && {
      started_at: latest.started_at,
      status: latest.status,
      jobs_stored: latest.jobs_stored,
    },
  });
}
