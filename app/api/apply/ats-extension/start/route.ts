import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { normalizePlan } from "@/lib/plan-limits";
import { AUTO_APPLY_LIMIT_RESPONSE, checkAndIncrementAutoApply } from "@/lib/usage";
import { applyRoute, applySubmitUrl, detectATS } from "@/lib/detect-apply-type";
import { greenhouseViaExtension, JOB_SITE_CONSENT_REQUIRED_RESPONSE } from "@/lib/job-site-consent";
import { jobSiteAutomationConsentAt } from "@/lib/job-site-consent.server";
import { blockedResponse, blockingApplication, withJobLock } from "@/lib/extension-handover";

// Hands a Greenhouse application to the extension, which fills in and
// submits the form in the user's own browser (stage 3 of moving ATS applying
// into the extension). The page has already checked the extension is 1.6.0+.
//
// POST { jobId } → { application_id }. Charges one auto-apply, once per
// application, like every other submit path; the extension reports the
// outcome to /api/applications/update-status, which refunds manual/failed.
// The extension then reads everything else itself: /api/apply/ats-package/…
// (form URL, cover letter, CV) and /api/apply/form-answers/… (the form's
// questions and the answers, facts only from the user).
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!greenhouseViaExtension()) {
      return NextResponse.json({ error: "not_enabled" }, { status: 404 });
    }
    if (!(await jobSiteAutomationConsentAt(user.id))) {
      return NextResponse.json(JOB_SITE_CONSENT_REQUIRED_RESPONSE, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const jobId = typeof body?.jobId === "string" ? body.jobId : null;
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

    const jobs = await db.$queryRaw<{ url: string; apply_url: string | null; apply_type: string | null }[]>`
      SELECT url, apply_url, apply_type FROM "Job" WHERE id = ${jobId} LIMIT 1
    `;
    if (!jobs.length) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    // Greenhouse only, so far — the extension fills no other ATS yet.
    if (applyRoute(jobs[0]) !== "ats" || detectATS(applySubmitUrl(jobs[0])) !== "greenhouse") {
      return NextResponse.json({ error: "not_greenhouse" }, { status: 400 });
    }

    // One hand-over per job at a time (lib/extension-handover.ts), decided and
    // charged under a lock so a double click can't make two.
    const result = await withJobLock(user.id, jobId, async (tx) => {
      const blocking = await blockingApplication(tx, user.id, jobId);
      if (blocking) return { kind: "blocked", status: blocking.status } as const;

      const existing = await tx.$queryRaw<{ id: string; auto_apply_charged: boolean }[]>`
        SELECT id, auto_apply_charged FROM "Application"
        WHERE user_id = ${user.id} AND job_id = ${jobId}
        ORDER BY applied_at DESC
        LIMIT 1
      `;
      if (!existing[0]?.auto_apply_charged) {
        const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { plan: true } });
        const { allowed } = await checkAndIncrementAutoApply(user.id, normalizePlan(dbUser?.plan));
        if (!allowed) return { kind: "limit" } as const;
      }

      if (existing.length) {
        await tx.$executeRaw`
          UPDATE "Application"
          SET status = 'pending_extension', auto_apply_charged = true, applied_at = NOW(),
              error_message = NULL, missing_questions = NULL
          WHERE id = ${existing[0].id} AND user_id = ${user.id}
        `;
        return { kind: "ok", applicationId: existing[0].id } as const;
      }
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "Application" (id, user_id, job_id, status, applied_at, auto_apply_charged)
        VALUES (gen_random_uuid(), ${user.id}, ${jobId}, 'pending_extension', NOW(), true)
        RETURNING id
      `;
      return { kind: "ok", applicationId: rows[0].id } as const;
    });

    if (result.kind === "blocked") return NextResponse.json(blockedResponse(result.status), { status: 409 });
    if (result.kind === "limit") return NextResponse.json(AUTO_APPLY_LIMIT_RESPONSE, { status: 403 });
    const applicationId = result.applicationId;

    return NextResponse.json({ application_id: applicationId });
  } catch (err) {
    console.error("[apply/ats-extension/start]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
