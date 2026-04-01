import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { application_id, cover_letter } = await req.json();
    if (!application_id) {
      return NextResponse.json({ error: "application_id required" }, { status: 400 });
    }

    // Update cover letter (user may have edited it)
    await db.$executeRaw`
      UPDATE "Application"
      SET cover_letter = ${cover_letter}
      WHERE id = ${application_id} AND user_id = ${user.id}
    `;

    // Get job URL via join
    const rows = await db.$queryRaw<{ url: string }[]>`
      SELECT j.url FROM "Application" a
      JOIN "Job" j ON j.id = a.job_id
      WHERE a.id = ${application_id} AND a.user_id = ${user.id}
      LIMIT 1
    `;
    if (!rows.length) {
      return NextResponse.json({ error: "Application not found." }, { status: 404 });
    }
    const job_url = rows[0].url;

    // Call Python apply handler
    let pythonData: { status: string; message: string } = {
      status: "failed",
      message: "Python service unavailable",
    };

    try {
      const pythonRes = await fetch(`${process.env.PYTHON_SERVICE_URL}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_url, application_id, user_id: user.id }),
        signal: AbortSignal.timeout(120_000),
      });
      pythonData = await pythonRes.json();
    } catch (e) {
      console.error("[apply/submit] python call failed:", e);
    }

    // Update application status
    const finalStatus =
      pythonData.status === "applied" || pythonData.status === "manual"
        ? "applied"
        : "failed";

    await db.$executeRaw`
      UPDATE "Application"
      SET status = ${finalStatus}
      WHERE id = ${application_id}
    `;

    return NextResponse.json({
      status: pythonData.status,
      message: pythonData.message,
    });
  } catch (err) {
    console.error("[apply/submit]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
