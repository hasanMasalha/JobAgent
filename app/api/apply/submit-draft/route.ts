import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

// Saves edited cover letter without triggering automation
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

    await db.$executeRaw`
      UPDATE "Application"
      SET cover_letter = ${cover_letter ?? ""}
      WHERE id = ${application_id} AND user_id = ${user.id}
    `;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[apply/submit-draft]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
