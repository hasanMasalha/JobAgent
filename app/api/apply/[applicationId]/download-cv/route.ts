import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { generateCVDocx } from "@/lib/generate-cv";

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

    const rows = await db.$queryRaw<
      { tailored_cv: string | null; job_title: string; company: string; user_name: string | null }[]
    >`
      SELECT a.tailored_cv, j.title AS job_title, j.company, u.name AS user_name
      FROM "Application" a
      JOIN "Job" j ON j.id = a.job_id
      LEFT JOIN "User" u ON u.id = a.user_id
      WHERE a.id = ${params.applicationId} AND a.user_id = ${user.id}
      LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const { tailored_cv, job_title, user_name } = rows[0];

    if (!tailored_cv) {
      return NextResponse.json(
        { error: "No tailored CV for this application. Please go through the apply flow again." },
        { status: 404 }
      );
    }

    const cvRows = await db.$queryRaw<{ hyperlinks_json: string | null }[]>`
      SELECT hyperlinks_json FROM "CV" WHERE user_id = ${user.id} LIMIT 1
    `;
    const hyperlinks = JSON.parse(cvRows[0]?.hyperlinks_json ?? "[]");

    const buffer = await generateCVDocx(tailored_cv, job_title, hyperlinks);

    const displayName = user_name?.trim() || (user.email?.split("@")[0] ?? "CV");
    const filename = `CV_${displayName}`
      .replace(/[^a-zA-Z0-9_\-]/g, "_")
      .slice(0, 60) + ".docx";

    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[download-cv]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
