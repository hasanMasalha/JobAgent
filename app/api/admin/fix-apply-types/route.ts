import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { detectApplyType, extractRecruiterEmail } from "@/lib/detect-apply-type";

// One-time backfill endpoint. Protected by INTERNAL_API_KEY.
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

  let fixed = 0;
  for (const job of jobs) {
    const applyType = detectApplyType({
      url: job.url ?? "",
      source: job.source ?? "",
      description: job.description ?? "",
    });
    const email = extractRecruiterEmail(job.description ?? "");

    if (applyType !== job.apply_type || email) {
      await db.job.update({
        where: { id: job.id },
        data: { apply_type: applyType, recruiter_email: email ?? undefined },
      });
      fixed++;
    }
  }

  return NextResponse.json({ success: true, total: jobs.length, fixed });
}
