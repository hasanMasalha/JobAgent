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
  const linkedinJobId = jobIdParam ?? (jobUrl ? extractJobId(jobUrl) : null);

  console.log(`[check-pending] userId=${userId} jobIdParam=${jobIdParam} jobUrl=${jobUrl} → linkedinJobId=${linkedinJobId}`);

  // --- DEBUG: show all pending_extension apps for this user ---
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

  // Fetch profile defaults, saved answers, and CV skills in parallel
  const [profile, savedAnswers, cvRows] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        first_name: true,
        last_name: true,
        phone: true,
        city: true,
        linkedin_url: true,
        github_url: true,
        portfolio_url: true,
        expected_salary: true,
        notice_period: true,
        years_of_experience: true,
        highest_education: true,
        work_authorized: true,
        requires_sponsorship: true,
        willing_to_relocate: true,
      },
    }),
    db.easyApplyAnswer.findMany({ where: { user_id: userId } }),
    db.$queryRaw<{ skills_json: unknown }[]>`
      SELECT skills_json FROM "CV" WHERE user_id = ${userId} LIMIT 1
    `,
  ]);

  const skills: string[] = (() => {
    const raw = cvRows[0]?.skills_json;
    if (Array.isArray(raw)) return raw as string[];
    return [];
  })();

  const answersMap = Object.fromEntries(
    savedAnswers.map((a) => [a.question, a.answer])
  );

  return NextResponse.json({
    pending: true,
    application: {
      id: rows[0].id,
      jobUrl: rows[0].job_url,
      // Personal
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      phone: profile?.phone ?? null,
      city: profile?.city ?? null,
      // URLs
      linkedin_url: profile?.linkedin_url ?? null,
      github_url: profile?.github_url ?? null,
      portfolio_url: profile?.portfolio_url ?? null,
      // Work details
      expected_salary: profile?.expected_salary ?? null,
      notice_period: profile?.notice_period ?? "30",
      years_of_experience: profile?.years_of_experience ?? "2",
      highest_education: profile?.highest_education ?? "Bachelor's Degree",
      // Boolean defaults
      work_authorized: profile?.work_authorized ?? true,
      requires_sponsorship: profile?.requires_sponsorship ?? false,
      willing_to_relocate: profile?.willing_to_relocate ?? false,
      // CV skills
      skills,
      // Learned answers from previous applications
      savedAnswers: answersMap,
    },
  });
}
