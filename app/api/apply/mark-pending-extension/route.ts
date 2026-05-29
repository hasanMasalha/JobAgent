import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

// Marks an application as pending_extension so the Chrome Extension picks it up
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { application_id } = await req.json();
    if (!application_id) {
      return NextResponse.json({ error: "application_id required" }, { status: 400 });
    }

    await db.$executeRaw`
      UPDATE "Application"
      SET status = 'pending_extension'
      WHERE id = ${application_id} AND user_id = ${user.id}
    `;

    const cvRows = await db.$queryRaw<{ skills_json: unknown }[]>`
      SELECT skills_json FROM "CV" WHERE user_id = ${user.id} LIMIT 1
    `;
    const skills: string[] = (() => {
      const raw = cvRows[0]?.skills_json;
      if (Array.isArray(raw)) return raw as string[];
      return [];
    })();

    return NextResponse.json({ success: true, skills });
  } catch (err) {
    console.error("[apply/mark-pending-extension]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
