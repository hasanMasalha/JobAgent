import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { generateCVDocx } from "@/lib/generate-cv";

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cvId = req.nextUrl.searchParams.get("cv_id");
    if (!cvId) {
      return NextResponse.json({ error: "cv_id is required" }, { status: 400 });
    }

    const rows = await db.$queryRaw<{ raw_text: string; skills_json: { skills?: string[] } | null }[]>`
      SELECT raw_text, skills_json FROM "CV" WHERE id = ${cvId} AND user_id = ${user.id} LIMIT 1
    `;

    if (!rows.length || !rows[0].raw_text) {
      return NextResponse.json({ error: "No CV found" }, { status: 404 });
    }

    const { raw_text, skills_json } = rows[0];

    // Derive job title from skills_json or first line of CV
    const firstLine = raw_text.split("\n").find((l) => l.trim()) ?? "CV";
    const jobTitle = skills_json?.skills?.[0] ?? firstLine;

    const buffer = await generateCVDocx(raw_text, jobTitle);

    const safeName = firstLine.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_") || "CV";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeName}_CV.docx"`,
      },
    });
  } catch (err) {
    console.error("[cv/download-generated]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
