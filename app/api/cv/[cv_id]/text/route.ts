import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { cv_id: string } }
) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await db.$queryRaw<{ raw_text: string; updated_at: Date }[]>`
      SELECT raw_text, updated_at
      FROM "CV"
      WHERE id = ${params.cv_id} AND user_id = ${user.id}
      LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      raw_text: rows[0].raw_text,
      created_at: rows[0].updated_at.toISOString(),
    });
  } catch (err) {
    console.error("[cv/[cv_id]/text]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
