import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { applicationId: string } }
) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the application belongs to this user
    const rows = await db.$queryRaw<{ job_title: string; company: string }[]>`
      SELECT j.title AS job_title, j.company
      FROM "Application" a
      JOIN "Job" j ON j.id = a.job_id
      WHERE a.id = ${params.applicationId} AND a.user_id = ${user.id}
      LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const pythonUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
    const pdfRes = await fetch(
      `${pythonUrl}/generate-cv-pdf?application_id=${encodeURIComponent(params.applicationId)}`
    );

    if (!pdfRes.ok) {
      const body = await pdfRes.text();
      console.error("[download-cv] Python error", pdfRes.status, body);
      let detail = "PDF generation failed";
      try { detail = JSON.parse(body).detail ?? detail; } catch { /* plain text */ }
      return NextResponse.json({ error: detail }, { status: pdfRes.status });
    }

    const pdfBytes = await pdfRes.arrayBuffer();
    const { job_title, company } = rows[0];
    const filename = `CV_${company}_${job_title}`
      .replace(/[^a-zA-Z0-9_\-]/g, "_")
      .slice(0, 60) + ".pdf";

    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[download-cv]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
