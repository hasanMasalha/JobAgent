import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [cvRows, prefRows, dbUser] = await Promise.all([
      db.$queryRaw<{ clean_summary: string | null; skills_json: string | null; updated_at: Date }[]>`
        SELECT clean_summary, skills_json, updated_at
        FROM "CV" WHERE user_id = ${user.id} LIMIT 1
      `,
      db.$queryRaw<{ titles: string[]; locations: string[]; remote_ok: boolean; min_salary: number | null }[]>`
        SELECT titles, locations, remote_ok, min_salary
        FROM "JobPreference" WHERE user_id = ${user.id} LIMIT 1
      `,
      db.user.findUnique({
        where: { id: user.id },
        select: { google_connected: true },
      }),
    ]);

    return NextResponse.json({
      cv: cvRows[0] ?? null,
      preferences: prefRows[0] ?? null,
      google_connected: dbUser?.google_connected ?? false,
    });
  } catch (err) {
    console.error("[profile GET]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
