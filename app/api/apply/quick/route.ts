import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { normalizePlan } from "@/lib/plan-limits";
import {
  AUTO_APPLY_LIMIT_RESPONSE,
  checkAndIncrementAutoApply,
  refundAutoApply,
  refundAutoApplyForApplication,
} from "@/lib/usage";
import { pythonFetch, pythonServiceUrl } from "@/lib/python-service";

export const maxDuration = 60;

function detectATS(url: string): string | null {
  const u = (url || "").toLowerCase();
  // gh_jid means Greenhouse is embedded on the company's own domain instead
  // of greenhouse.io directly.
  if (u.includes("greenhouse.io") || u.includes("gh_jid=")) return "greenhouse";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("workable.com")) return "workable";
  if (u.includes("comeet.com")) return "comeet";
  if (u.includes("ashbyhq.com")) return "ashby";
  if (u.includes("bamboohr.com")) return "bamboohr";
  return null;
}

export async function POST(req: NextRequest) {
  // Set once an auto-apply credit is taken, so the catch block can give it
  // back if anything after that throws.
  let chargedUserId: string | null = null;
  let chargedApplicationId: string | null = null;
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId } = (await req.json()) as { jobId: string };
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

    const jobRows = await db.$queryRaw<{ url: string; apply_url: string | null; title: string; company: string; apply_type: string | null }[]>`
      SELECT url, apply_url, title, company, apply_type FROM "Job" WHERE id = ${jobId} LIMIT 1
    `;
    if (!jobRows.length) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    const job = jobRows[0];

    // External jobs have no automation — return early so the client opens the URL
    if (job.apply_type === "external") {
      await db.$executeRaw`
        INSERT INTO "Application" (id, user_id, job_id, status, applied_at)
        VALUES (gen_random_uuid(), ${user.id}, ${jobId}, 'manual', now())
        ON CONFLICT DO NOTHING
      `;
      return NextResponse.json({
        success: true,
        status: "external",
        external_url: job.url,
        message: "External job — apply manually",
      });
    }

    const profile = await db.user.findFirst({
      where: { OR: [{ id: user.id }, { email: user.email! }] },
      select: {
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
        linkedin_url: true,
      },
    });
    if (!profile) return NextResponse.json({ error: "User profile not found" }, { status: 404 });

    // apply_url is the confirmed ATS URL (scraped from LinkedIn page).
    // Fall back to url only if apply_url is not set.
    const applyUrl = job.apply_url ?? job.url ?? "";

    // LinkedIn listing URL with no ATS apply_url — cannot auto-apply
    if (!job.apply_url && applyUrl.includes("linkedin.com")) {
      return NextResponse.json({
        success: false,
        needs_extension: true,
        message: "LinkedIn jobs require the browser extension",
      });
    }

    const atsPlatform = detectATS(applyUrl);

    if (atsPlatform) {
      // JobAgent is about to submit for the user: this is an auto-apply and
      // spends a monthly credit, same as batch. Checked before the
      // Application row exists, so a blocked request leaves nothing behind.
      // External / LinkedIn / no-ATS jobs returned above and aren't charged.
      const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { plan: true } });
      const { allowed } = await checkAndIncrementAutoApply(user.id, normalizePlan(dbUser?.plan));
      if (!allowed) return NextResponse.json(AUTO_APPLY_LIMIT_RESPONSE, { status: 403 });
      chargedUserId = user.id;

      // Create application record before calling Python
      const appRows = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO "Application" (id, user_id, job_id, status, applied_at, auto_apply_charged)
        VALUES (gen_random_uuid(), ${user.id}, ${jobId}, 'applying', now(), true)
        RETURNING id
      `;
      const applicationId = appRows[0].id;
      chargedApplicationId = applicationId;
      // Nothing was submitted: give the credit back.
      const refund = () => refundAutoApplyForApplication(applicationId, user.id);

      const pythonUrl = pythonServiceUrl("/ats-apply");
      console.log("[apply/quick] calling Python:", {
        url: pythonUrl,
        ats: atsPlatform,
        jobId,
        applyUrl: applyUrl.slice(0, 80),
        hasEmail: !!(profile.email ?? user.email),
        hasPhone: !!profile.phone,
        hasName: !!(profile.first_name || profile.last_name),
      });

      const pythonRes = await pythonFetch("/ats-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          apply_url: applyUrl,
          ats_platform: atsPlatform,
          application_id: applicationId,
          user_id: user.id,
          first_name: profile.first_name ?? "",
          last_name: profile.last_name ?? "",
          email: profile.email ?? user.email ?? "",
          phone: profile.phone ?? "",
          linkedin_url: profile.linkedin_url ?? "",
        }),
        signal: AbortSignal.timeout(110_000),
      });

      console.log("[apply/quick] Python response status:", pythonRes.status);

      if (!pythonRes.ok) {
        const rawBody = await pythonRes.text();
        console.error("[apply/quick] Python error body:", rawBody.slice(0, 500));
        await db.$executeRaw`
          UPDATE "Application" SET status = 'failed', error_message = ${`Python service error (${pythonRes.status})`} WHERE id = ${applicationId}
        `;
        await refund();
        return NextResponse.json(
          { success: false, error: `ATS service error (${pythonRes.status})` },
          { status: 500 }
        );
      }

      const rawBody = await pythonRes.text();
      console.log("[apply/quick] Python response body:", rawBody.slice(0, 300));

      const result = (JSON.parse(rawBody)) as {
        success: boolean;
        error?: string;
        status?: string;
        captcha?: boolean;
        captcha_type?: string;
        filled?: string[];
      };

      if (result.captcha) {
        await db.$executeRaw`
          UPDATE "Application" SET status = 'manual' WHERE id = ${applicationId}
        `;
        await refund();
        return NextResponse.json({
          success: false,
          captcha: true,
          captcha_type: result.captcha_type,
          manual_url: applyUrl,
          message: "Form has CAPTCHA — please apply manually",
        });
      }

      if (!result.success) {
        await db.$executeRaw`
          UPDATE "Application" SET status = 'failed', error_message = ${result.error ?? "ATS apply failed"} WHERE id = ${applicationId}
        `;
        await refund();
        return NextResponse.json(
          { success: false, error: result.error ?? "ATS apply failed" },
          { status: 500 }
        );
      }

      if (result.status === "pending_verification") {
        return NextResponse.json({
          success: true,
          status: "pending_verification",
          application_id: applicationId,
          message: "Check your email for a verification code from Greenhouse to complete your application.",
        });
      }

      return NextResponse.json({
        success: true,
        status: "applying",
        application_id: applicationId,
        message: "Application submitted in background",
      });
    }

    // External job — no ATS detected, open directly
    await db.$queryRaw<{ id: string }[]>`
      INSERT INTO "Application" (id, user_id, job_id, status, applied_at)
      VALUES (gen_random_uuid(), ${user.id}, ${jobId}, 'manual', now())
      RETURNING id
    `;
    return NextResponse.json({
      success: true,
      status: "external",
      external_url: applyUrl,
      message: "Opening job page",
    });
  } catch (err) {
    console.error("[apply/quick]", err);
    // Charged but the submission didn't complete: refund. Via the
    // application when it exists (at most once), otherwise directly.
    if (chargedUserId) {
      try {
        if (chargedApplicationId) await refundAutoApplyForApplication(chargedApplicationId, chargedUserId);
        else await refundAutoApply(chargedUserId);
      } catch (refundErr) {
        console.error("[apply/quick] auto-apply refund failed", refundErr);
      }
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
