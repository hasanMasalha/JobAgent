import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { normalizePlan } from "@/lib/plan-limits";
import { AUTO_APPLY_LIMIT_RESPONSE, checkAndIncrementAutoApply } from "@/lib/usage";
import { LINKEDIN_CONSENT_REQUIRED_RESPONSE } from "@/lib/linkedin-consent";
import { linkedInAutomationConsentAt } from "@/lib/linkedin-consent.server";
import { blockedResponse, blockingApplication, withJobLock } from "@/lib/extension-handover";

// Marks an application as pending_extension so the Chrome Extension picks it up.
// Accepts either:
//   application_id — update an existing Application (apply page flow)
//   jobId          — find or create an Application for this job (direct auto-apply flow)
//
// Both flows spend one auto-apply credit, once per application: JobAgent's
// extension is about to submit for the user. The credit comes back when the
// extension reports manual/failed (/api/applications/update-status). The
// application_id flow used to be free here because the apply page charged a
// CV tailoring instead; LinkedIn jobs are no longer tailored (Easy Apply
// sends the résumé on the user's LinkedIn profile), so it charges like the
// other submit paths.
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Nothing goes to the extension until the user has accepted the LinkedIn
    // automation notice (/dashboard/linkedin-extension).
    if (!(await linkedInAutomationConsentAt(user.id))) {
      return NextResponse.json(LINKEDIN_CONSENT_REQUIRED_RESPONSE, { status: 403 });
    }

    const body = await req.json();
    const { application_id, jobId } = body;

    if (!application_id && !jobId) {
      return NextResponse.json({ error: "application_id or jobId required" }, { status: 400 });
    }

    // The job this hand-over is for: the application's own, or the one given.
    let targetJobId: string = jobId;
    if (application_id) {
      const own = await db.$queryRaw<{ job_id: string }[]>`
        SELECT job_id FROM "Application"
        WHERE id = ${application_id} AND user_id = ${user.id}
        LIMIT 1
      `;
      if (!own.length) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      targetJobId = own[0].job_id;
    }

    // One hand-over per job at a time (lib/extension-handover.ts), decided and
    // charged under a lock. An apply page reopened while the job was pending
    // has a new draft; confirming it used to charge and queue a second one.
    const result = await withJobLock(user.id, targetJobId, async (tx) => {
      const blocking = await blockingApplication(tx, user.id, targetJobId);
      if (blocking) return { kind: "blocked", status: blocking.status } as const;

      // Apply page flow: the application /api/apply/prepare created. Direct
      // flow from the dashboard: the job's latest application, or a new one.
      const existing = application_id
        ? await tx.$queryRaw<{ id: string; auto_apply_charged: boolean }[]>`
            SELECT id, auto_apply_charged FROM "Application"
            WHERE id = ${application_id} AND user_id = ${user.id}
            LIMIT 1
          `
        : await tx.$queryRaw<{ id: string; auto_apply_charged: boolean }[]>`
            SELECT id, auto_apply_charged FROM "Application"
            WHERE user_id = ${user.id} AND job_id = ${targetJobId}
            ORDER BY applied_at DESC
            LIMIT 1
          `;

      if (!existing[0]?.auto_apply_charged) {
        const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { plan: true } });
        const { allowed } = await checkAndIncrementAutoApply(user.id, normalizePlan(dbUser?.plan));
        if (!allowed) return { kind: "limit" } as const;
      }

      if (existing.length > 0) {
        await tx.$executeRaw`
          UPDATE "Application"
          SET status = 'pending_extension', auto_apply_charged = true, applied_at = NOW()
          WHERE id = ${existing[0].id} AND user_id = ${user.id}
        `;
        return { kind: "ok", applicationId: existing[0].id } as const;
      }
      const newApp = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO "Application" (id, user_id, job_id, status, applied_at, auto_apply_charged)
        VALUES (gen_random_uuid(), ${user.id}, ${targetJobId}, 'pending_extension', NOW(), true)
        RETURNING id
      `;
      return { kind: "ok", applicationId: newApp[0].id } as const;
    });

    if (result.kind === "blocked") return NextResponse.json(blockedResponse(result.status), { status: 409 });
    if (result.kind === "limit") return NextResponse.json(AUTO_APPLY_LIMIT_RESPONSE, { status: 403 });
    const resultApplicationId = result.applicationId;

    const cvRows = await db.$queryRaw<{ skills_json: unknown }[]>`
      SELECT skills_json FROM "CV" WHERE user_id = ${user.id} LIMIT 1
    `;
    const skills: string[] = (() => {
      const raw = cvRows[0]?.skills_json;
      if (Array.isArray(raw)) return raw as string[];
      return [];
    })();

    return NextResponse.json({ success: true, application_id: resultApplicationId, skills });
  } catch (err) {
    console.error("[apply/mark-pending-extension]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
