import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

// Handles both URL formats:
//   /jobs/view/4417922448/                              → standard
//   /jobs/view/hebrew-text-4417922448?originalSubdomain=il  → Hebrew slug
function extractJobId(url: string): string | null {
  const standard = url.match(/\/jobs\/view\/(\d+)/);
  if (standard) return standard[1];

  const path = url.split("?")[0];
  const numbers = path.match(/(\d{8,})/g);
  if (numbers && numbers.length > 0) return numbers[numbers.length - 1];

  return null;
}

export async function GET(request: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { searchParams } = new URL(request.url);

  // Accept userId as query param when cross-site cookies are blocked (extension context)
  const userId = user?.id ?? searchParams.get("userId");
  if (!userId) return NextResponse.json({ pending: false });

  const jobIdParam = searchParams.get("jobId");
  const jobUrl = searchParams.get("jobUrl");

  if (!jobIdParam && !jobUrl) return NextResponse.json({ pending: false });

  // Prefer explicit jobId param; fall back to extracting from the jobUrl.
  // extractJobId handles Hebrew slugs where /view/ is followed by text, not digits.
  const linkedinJobId = jobIdParam ?? (jobUrl ? extractJobId(jobUrl) : null);

  console.log(`[check-pending] userId=${userId} jobIdParam=${jobIdParam} jobUrl=${jobUrl} → linkedinJobId=${linkedinJobId}`);

  // --- DEBUG: show all pending_extension apps for this user so we can compare ---
  const allPending = await db.$queryRaw<{ id: string; job_id: string; status: string; job_url: string }[]>`
    SELECT a.id, a.job_id, a.status, j.url AS job_url
    FROM "Application" a
    JOIN "Job" j ON j.id = a.job_id
    WHERE a.user_id = ${userId} AND a.status = 'pending_extension'
  `;
  console.log(`[check-pending] all pending_extension for user:`, JSON.stringify(allPending));
  // --- END DEBUG ---

  let rows: { id: string; job_url: string }[];

  if (linkedinJobId) {
    // Search for the job ID anywhere in the stored URL — handles both:
    //   stored: /jobs/view/4417922448/
    //   stored: /jobs/view/hebrew-text-4417922448/   (Hebrew slug from JobSpy)
    rows = await db.$queryRaw<{ id: string; job_url: string }[]>`
      SELECT a.id, j.url AS job_url
      FROM "Application" a
      JOIN "Job" j ON j.id = a.job_id
      WHERE a.user_id = ${userId}
        AND a.status = 'pending_extension'
        AND j.url LIKE ${`%${linkedinJobId}%`}
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

  console.log(`[check-pending] matched application: ${rows[0]?.id ?? "none"}`);

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
