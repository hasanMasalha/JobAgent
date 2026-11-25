import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { attachmentDisposition } from "@/lib/content-disposition";
import { cvDisplayName, cvFormat, renderCvFile } from "@/lib/cv-file";

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

    const rows = await db.$queryRaw<{
      raw_text: string;
      hyperlinks_json: string | null;
      source: string;
      original_file: Buffer | null;
      original_filename: string | null;
      original_mime_type: string | null;
    }[]>`
      SELECT raw_text, hyperlinks_json, source, original_file, original_filename, original_mime_type
      FROM "CV" WHERE id = ${cvId} AND user_id = ${user.id} LIMIT 1
    `;

    if (!rows.length || !rows[0].raw_text) {
      return NextResponse.json({ error: "No CV found" }, { status: 404 });
    }

    const { raw_text, hyperlinks_json, source, original_file, original_filename, original_mime_type } = rows[0];

    // Uploaded CV — send the user's own file back exactly as they gave it to
    // us, never re-rendered. (Pre-migration uploads have no original_file on
    // file; those fall through to the generated-style render below rather
    // than claim a design we can't verify came from AI-authored text.)
    if (source === "uploaded" && original_file && original_filename) {
      return new NextResponse(new Uint8Array(original_file), {
        status: 200,
        headers: {
          "Content-Type": original_mime_type ?? "application/octet-stream",
          "Content-Disposition": `attachment; filename="${original_filename.replace(/"/g, "")}"`,
        },
      });
    }

    // PDF unless the user asked for Word (?format=docx).
    const hyperlinks = JSON.parse(hyperlinks_json ?? "[]");
    const file = await renderCvFile(raw_text, cvFormat(req.nextUrl.searchParams.get("format")), hyperlinks);

    return new NextResponse(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": attachmentDisposition(`${cvDisplayName(raw_text, user.email)}_CV.${file.extension}`),
      },
    });
  } catch (err) {
    console.error("[cv/download-generated]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
