import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { detectApplyType, extractRecruiterEmail } from "@/lib/detect-apply-type";

// Backfill endpoint: re-detect apply_type and recruiter_email for all jobs.
// Protected by INTERNAL_API_KEY.
// Call with: curl -X POST http://localhost:3000/api/admin/fix-apply-types \
//   -H "x-api-key: <INTERNAL_API_KEY>"
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await db.job.findMany({
    select: { id: true, url: true, source: true, description: true, apply_type: true },
  });

  // Bucket jobs by their correct apply_type and recruiter_email
  const byType: Record<string, string[]> = { extension: [], external: [], auto: [] };
  const emailUpdates: { id: string; email: string }[] = [];

  for (const job of jobs) {
    const url = (job.url ?? "").toLowerCase();

    // Skip LinkedIn — can't determine Easy Apply from URL alone.
    // Only new scrapes with is_easy_apply=true should be 'extension'.
    if (url.includes("linkedin.com")) continue;

    const applyType = detectApplyType({
      url: job.url ?? "",
      source: job.source ?? "",
      description: job.description ?? "",
    });
    if (applyType !== job.apply_type) {
      byType[applyType]?.push(job.id);
    }
    const email = extractRecruiterEmail(job.description ?? "");
    if (email) emailUpdates.push({ id: job.id, email });
  }

  // Bulk-update each apply_type bucket in one query each
  let fixed = 0;
  for (const [applyType, ids] of Object.entries(byType)) {
    if (!ids.length) continue;
    await db.job.updateMany({
      where: { id: { in: ids } },
      data: { apply_type: applyType },
    });
    fixed += ids.length;
  }

  // Email updates are still per-row (different values each time)
  for (const { id, email } of emailUpdates) {
    await db.job.update({ where: { id }, data: { recruiter_email: email } });
  }

  return NextResponse.json({
    success: true,
    total: jobs.length,
    fixed,
    email_updated: emailUpdates.length,
  });
}
