import { NextRequest, NextResponse } from "next/server";
import { getSessionOrExtensionUserId } from "@/lib/extension-token";
import { db } from "@/lib/db";
import { extensionVersionOk, MIN_EXTENSION_VERSION } from "@/lib/extension-version";
import { refundAutoApplyForApplication } from "@/lib/usage";

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
  // Session, or the extension's signed token. A userId query param is
  // ignored — it used to be trusted, which let anyone read another user's
  // profile data.
  const userId = await getSessionOrExtensionUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);

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

  // Extensions older than MIN_EXTENSION_VERSION fill in answers nobody
  // entered, so they don't get the application. It is handed back as
  // "apply manually" and its auto-apply credit returned, so nothing is left
  // waiting on an extension that will never be allowed to submit it.
  if (!extensionVersionOk(request)) {
    await refundAutoApplyForApplication(rows[0].id, userId);
    await db.$executeRaw`
      UPDATE "Application"
      SET status = 'manual', error_message = 'The JobAgent extension is out of date. Update it to apply on LinkedIn.'
      WHERE id = ${rows[0].id} AND user_id = ${userId}
    `;
    return NextResponse.json({ pending: false, upgrade_required: true, min_version: MIN_EXTENSION_VERSION });
  }

  // Fetch the user's answers, saved answers, and CV skills in parallel
  const [profile, savedAnswers, cvRows] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        application_details_confirmed_at: true,
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

  // No fallbacks: a missing answer is null and the extension leaves the
  // question blank and stops. These six columns once had database defaults,
  // so they count as the user's answers only after the user has saved or
  // approved them.
  const confirmed = !!profile?.application_details_confirmed_at;

  return NextResponse.json({
    pending: true,
    application: {
      id: rows[0].id,
      jobUrl: rows[0].job_url,
      // Personal
      email: profile?.email ?? null,
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
      notice_period: confirmed ? profile?.notice_period ?? null : null,
      years_of_experience: confirmed ? profile?.years_of_experience ?? null : null,
      highest_education: confirmed ? profile?.highest_education ?? null : null,
      work_authorized: confirmed ? profile?.work_authorized ?? null : null,
      requires_sponsorship: confirmed ? profile?.requires_sponsorship ?? null : null,
      willing_to_relocate: confirmed ? profile?.willing_to_relocate ?? null : null,
      // CV skills
      skills,
      // Learned answers from previous applications
      savedAnswers: answersMap,
    },
  });
}
