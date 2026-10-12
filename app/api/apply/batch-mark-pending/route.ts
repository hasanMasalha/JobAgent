import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { normalizePlan } from "@/lib/plan-limits";
import { AUTO_APPLY_LIMIT_RESPONSE, checkAndIncrementAutoApply } from "@/lib/usage";
import { isLinkedInListing } from "@/lib/detect-apply-type";
import { MAX_EXTENSION_BATCH } from "@/lib/extension-batch";
import { LINKEDIN_CONSENT_REQUIRED_RESPONSE } from "@/lib/linkedin-consent";
import { linkedInAutomationConsentAt } from "@/lib/linkedin-consent.server";
import { blockingApplication, withJobLock } from "@/lib/extension-handover";

// Creates Application rows (status = pending_extension) for each job so
// the extension queue can pick them up. Does not call Claude — the
// extension fills forms directly using saved profile defaults.
//
// Each queued job spends one monthly auto-apply credit, like quick apply's
// ATS submit. If the extension later reports manual/failed,
// /api/applications/update-status refunds it. A job that already holds a
// credit (re-queued) isn't charged again. Jobs past the limit aren't queued.
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Nothing goes to the extension until the user has accepted the LinkedIn
    // automation notice (/dashboard/linkedin-extension).
    if (!(await linkedInAutomationConsentAt(user.id))) {
      return NextResponse.json(LINKEDIN_CONSENT_REQUIRED_RESPONSE, { status: 403 });
    }

    const { jobIds } = await req.json() as { jobIds: string[] };
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json({ error: "jobIds array required" }, { status: 400 });
    }

    // Fetch job URLs for the requested IDs
    const found = await db.job.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, url: true },
    });

    // The extension only works on LinkedIn listings; anything else would be
    // charged for a tab the extension can do nothing with.
    const linkedin = found.filter((j) => isLinkedInListing(j.url));
    // One batch holds at most MAX_EXTENSION_BATCH jobs (the extension's hourly
    // cap). The rest are not queued and not charged.
    const jobs = linkedin.slice(0, MAX_EXTENSION_BATCH);
    const overBatchLimit = linkedin.slice(MAX_EXTENSION_BATCH).map((j) => j.id);

    const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { plan: true } });
    const plan = normalizePlan(dbUser?.plan);

    const results: { jobId: string; applicationId: string; jobUrl: string }[] = [];
    const limitReached: string[] = [];

    // Jobs already submitted or with the extension now: not queued again, not
    // charged (lib/extension-handover.ts).
    const alreadyQueued: string[] = [];

    for (const job of jobs) {
      const outcome = await withJobLock(user.id, job.id, async (tx) => {
        if (await blockingApplication(tx, user.id, job.id)) return { kind: "blocked" } as const;

        // Reuse the job's latest application or create one.
        const existing = await tx.application.findFirst({
          where: { user_id: user.id, job_id: job.id },
          orderBy: { applied_at: "desc" },
          select: { id: true, auto_apply_charged: true },
        });

        if (!existing?.auto_apply_charged) {
          const { allowed } = await checkAndIncrementAutoApply(user.id, plan);
          if (!allowed) return { kind: "limit" } as const;
        }

        if (existing) {
          await tx.application.update({
            where: { id: existing.id },
            data: { status: "pending_extension", auto_apply_charged: true, applied_at: new Date() },
          });
          return { kind: "ok", applicationId: existing.id } as const;
        }
        const created = await tx.application.create({
          data: {
            user_id: user.id,
            job_id: job.id,
            status: "pending_extension",
            auto_apply_charged: true,
          },
          select: { id: true },
        });
        return { kind: "ok", applicationId: created.id } as const;
      });

      if (outcome.kind === "blocked") alreadyQueued.push(job.id);
      else if (outcome.kind === "limit") limitReached.push(job.id);
      else results.push({ jobId: job.id, applicationId: outcome.applicationId, jobUrl: job.url });
    }

    // Nothing queued and the only reason is quota — same 403 as quick apply.
    if (results.length === 0 && limitReached.length > 0) {
      return NextResponse.json(AUTO_APPLY_LIMIT_RESPONSE, { status: 403 });
    }

    return NextResponse.json({ success: true, results, limitReached, overBatchLimit, alreadyQueued });
  } catch (err) {
    console.error("[batch-mark-pending]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
