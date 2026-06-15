import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

const ATS_API_PLATFORMS = ["greenhouse", "lever", "workable"] as const;
type ATSPlatform = (typeof ATS_API_PLATFORMS)[number];

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

    const [jobRows, profileRows] = await Promise.all([
      db.$queryRaw<{ url: string; title: string }[]>`
        SELECT url, title FROM "Job" WHERE id = ${jobId} LIMIT 1
      `,
      db.$queryRaw<{
        first_name: string | null;
        last_name: string | null;
        name: string | null;
        email: string;
        phone: string | null;
        linkedin_url: string | null;
      }[]>`
        SELECT first_name, last_name, name, email, phone, linkedin_url
        FROM "User" WHERE id = ${user.id} LIMIT 1
      `,
    ]);

    if (!jobRows.length) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (!profileRows.length) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const job = jobRows[0];
    const profile = profileRows[0];

    const atsPlatform = detectATS(job.url);
    if (!atsPlatform) {
      return NextResponse.json(
        { error: `No supported ATS detected in URL: ${job.url}` },
        { status: 400 }
      );
    }

    const firstName =
      profile.first_name ?? profile.name?.split(" ")[0] ?? "";
    const lastName =
      profile.last_name ?? profile.name?.split(" ").slice(1).join(" ") ?? "";

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
        email: profile.email ?? user.email ?? "",
        phone: profile.phone ?? "",
        linkedin_url: profile.linkedin_url ?? "",
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!pythonRes.ok) {
      const text = await pythonRes.text();
      console.error("[apply/ats] python error:", pythonRes.status, text.slice(0, 300));
      return NextResponse.json(
        { success: false, error: `ATS service error (${pythonRes.status})` },
        { status: 500 }
      );
    }

    const result = (await pythonRes.json()) as { success: boolean; error?: string; ats?: string };

    if (result.success) {
      await db.$executeRaw`
        UPDATE "Application" SET status = 'applied'
        WHERE id = ${applicationId} AND user_id = ${user.id}
      `;
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[apply/ats]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
