import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export const maxDuration = 60;

function detectATS(url: string): string | null {
  const u = (url || "").toLowerCase();
  if (u.includes("greenhouse.io")) return "greenhouse";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("workable.com")) return "workable";
  if (u.includes("comeet.com")) return "comeet";
  if (u.includes("ashbyhq.com")) return "ashby";
  if (u.includes("bamboohr.com")) return "bamboohr";
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId } = (await req.json()) as { jobId: string };
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

    const jobRows = await db.$queryRaw<{ url: string; title: string; company: string; apply_type: string | null }[]>`
      SELECT url, title, company, apply_type FROM "Job" WHERE id = ${jobId} LIMIT 1
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

    const applyUrl = job.url ?? "";

    // LinkedIn — requires extension, redirect to full flow
    if (applyUrl.includes("linkedin.com")) {
      return NextResponse.json({
        success: false,
        needs_extension: true,
        message: "LinkedIn jobs require the browser extension",
      });
    }

    const atsPlatform = detectATS(applyUrl);

    if (atsPlatform) {
      // Create application record before calling Python
      const appRows = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO "Application" (id, user_id, job_id, status, applied_at)
        VALUES (gen_random_uuid(), ${user.id}, ${jobId}, 'applying', now())
        RETURNING id
      `;
      const applicationId = appRows[0].id;

      const pythonUrl = `${process.env.PYTHON_SERVICE_URL}/ats-apply`;
      console.log("[apply/quick] calling Python:", {
        url: pythonUrl,
        ats: atsPlatform,
        jobId,
        applyUrl: applyUrl.slice(0, 80),
        hasEmail: !!(profile.email ?? user.email),
        hasPhone: !!profile.phone,
        hasName: !!(profile.first_name || profile.last_name),
      });

      const pythonRes = await fetch(pythonUrl, {
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
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
