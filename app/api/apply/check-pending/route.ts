import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { searchParams } = new URL(request.url);

  // Accept userId as query param when cross-site cookies are blocked (extension context)
  const userId = user?.id ?? searchParams.get("userId");
  if (!userId) return NextResponse.json({ pending: false });

  const jobId = searchParams.get("jobId");   // LinkedIn numeric job ID (preferred)
  const jobUrl = searchParams.get("jobUrl"); // Full job URL (fallback)

  if (!jobId && !jobUrl) return NextResponse.json({ pending: false });

  // Direct jobId takes priority; otherwise extract from jobUrl for fuzzy matching.
  // This handles trailing slashes and tracking params in window.location.href.
  const linkedinJobId = jobId ?? jobUrl?.match(/\/jobs\/view\/(\d+)/)?.[1] ?? null;

  let rows: { id: string; job_url: string }[];

  if (linkedinJobId) {
    rows = await db.$queryRaw<{ id: string; job_url: string }[]>`
      SELECT a.id, j.url AS job_url
      FROM "Application" a
      JOIN "Job" j ON j.id = a.job_id
      WHERE a.user_id = ${userId}
        AND a.status = 'pending_extension'
        AND j.url LIKE ${`%/jobs/view/${linkedinJobId}%`}
      LIMIT 1
    `;
  } else {
    rows = await db.$queryRaw<{ id: string; job_url: string }[]>`
      SELECT a.id, j.url AS job_url
      FROM "Application" a
      JOIN "Job" j ON j.id = a.job_id
      WHERE a.user_id = ${userId}
        AND a.status = 'pending_extension'
        AND j.url = ${jobUrl}
      LIMIT 1
    `;
  }

  if (!rows.length) return NextResponse.json({ pending: false });

  const cvRows = await db.$queryRaw<{ skills_json: unknown }[]>`
    SELECT skills_json FROM "CV" WHERE user_id = ${userId} LIMIT 1
  `;

  const skills: string[] = (() => {
    const raw = cvRows[0]?.skills_json;
    if (Array.isArray(raw)) return raw as string[];
    return [];
  })();

  return NextResponse.json({
    pending: true,
    application: {
      id: rows[0].id,
      jobUrl: rows[0].job_url,
      skills,
      phone: null,
      city: null,
      linkedin_url: null,
      expected_salary: null,
      notice_period: null,
    },
  });
}
