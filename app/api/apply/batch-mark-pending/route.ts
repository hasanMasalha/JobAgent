import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

// Creates Application rows (status = pending_extension) for each job so
// the extension queue can pick them up. Does not call Claude — the
// extension fills forms directly using saved profile defaults.
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobIds } = await req.json() as { jobIds: string[] };
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json({ error: "jobIds array required" }, { status: 400 });
    }

    // Fetch job URLs for the requested IDs
    const jobs = await db.job.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, url: true },
    });

    const results: { jobId: string; applicationId: string; jobUrl: string }[] = [];

    for (const job of jobs) {
      // Reuse existing pending application or create a new one
      const existing = await db.application.findFirst({
        where: { user_id: user.id, job_id: job.id },
        orderBy: { applied_at: "desc" },
        select: { id: true },
      });

      let applicationId: string;
      if (existing) {
        await db.application.update({
          where: { id: existing.id },
          data: { status: "pending_extension" },
        });
        applicationId = existing.id;
      } else {
        const created = await db.application.create({
          data: {
            user_id: user.id,
            job_id: job.id,
            status: "pending_extension",
          },
          select: { id: true },
        });
        applicationId = created.id;
      }

      results.push({ jobId: job.id, applicationId, jobUrl: job.url });
    }

    return NextResponse.json({ success: true, results });
  } catch (err) {
    console.error("[batch-mark-pending]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
