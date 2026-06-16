import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export const maxDuration = 120; // 2 minutes — Playwright runs in background but PDF gen can be slow

type ATSPlatform = "greenhouse" | "lever" | "workable";

function detectATS(url: string): ATSPlatform | null {
  const u = (url ?? "").toLowerCase();
  if (u.includes("greenhouse.io")) return "greenhouse";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("workable.com")) return "workable";
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId, applicationId, coverLetter } = (await req.json()) as {
      jobId: string;
      applicationId: string;
      coverLetter?: string;
    };
    if (!jobId || !applicationId) {
      return NextResponse.json({ error: "jobId and applicationId required" }, { status: 400 });
    }

    // Persist latest cover letter edits before submitting
    if (coverLetter !== undefined) {
      await db.$executeRaw`
        UPDATE "Application" SET cover_letter = ${coverLetter}
        WHERE id = ${applicationId} AND user_id = ${user.id}
      `;
    }

    console.log("[ats] user.id:", user.id, "user.email:", user.email);

    const [jobRows, profile] = await Promise.all([
      db.$queryRaw<{ url: string; title: string }[]>`
        SELECT url, title FROM "Job" WHERE id = ${jobId} LIMIT 1
      `,
      // Look up by email — User.id is a Prisma UUID, not the Supabase auth UUID
      db.user.findUnique({
        where: { email: user.email! },
        select: {
          first_name: true,
          last_name: true,
          email: true,
          phone: true,
          linkedin_url: true,
        },
      }),
    ]);

    if (!jobRows.length) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (!profile) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const job = jobRows[0];

    const atsPlatform = detectATS(job.url);
    if (!atsPlatform) {
      return NextResponse.json(
        { error: `No supported ATS detected in URL: ${job.url}` },
        { status: 400 }
      );
    }

    console.log("[ats] raw profile:", JSON.stringify(profile));

    const firstName = profile.first_name || "";
    const lastName = profile.last_name || "";
    const email = profile.email || user.email || "";

    console.log("[ats] firstName:", firstName);
    console.log("[ats] lastName:", lastName);
    console.log("[ats] email:", email);

    const pythonRes = await fetch(`${process.env.PYTHON_SERVICE_URL}/ats-apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        apply_url: job.url,
        ats_platform: atsPlatform,
        application_id: applicationId,
        user_id: user.id,
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: profile.phone ?? "",
        linkedin_url: profile.linkedin_url ?? "",
      }),
      signal: AbortSignal.timeout(110_000),
    });

    if (!pythonRes.ok) {
      const text = await pythonRes.text();
      console.error("[apply/ats] python error:", pythonRes.status, text.slice(0, 300));
      return NextResponse.json(
        { success: false, error: `ATS service error (${pythonRes.status})` },
        { status: 500 }
      );
    }

    const result = (await pythonRes.json()) as {
      success: boolean;
      error?: string;
      status?: string;
    };

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error ?? "ATS submission failed" },
        { status: 500 }
      );
    }

    // Python accepted and queued the background task — mark as 'applying'
    await db.$executeRaw`
      UPDATE "Application" SET status = 'applying'
      WHERE id = ${applicationId} AND user_id = ${user.id}
    `;

    return NextResponse.json({
      success: true,
      status: "applying",
      message: "Application is being submitted...",
    });
  } catch (err) {
    console.error("[apply/ats]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
