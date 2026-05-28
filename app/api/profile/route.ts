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

    const [cvRows, dbUser] = await Promise.all([
      db.$queryRaw<{ id: string; clean_summary: string | null; skills_json: string | null; updated_at: Date; raw_text: string }[]>`
        SELECT id, clean_summary, skills_json, updated_at, raw_text
        FROM "CV" WHERE user_id = ${user.id} LIMIT 1
      `,
      db.user.findUnique({
        where: { id: user.id },
        select: { google_connected: true, email_notifications: true },
      }),
    ]);

    // Run preferences query separately so a missing column (e.g. pending migration)
    // never causes the entire route to 500 and hide the CV from the client.
    let prefRows: { titles: string[]; locations: string[]; remote_ok: boolean; work_modes: string[]; min_salary: number | null }[] = [];
    try {
      prefRows = await db.$queryRaw`
        SELECT titles, locations, remote_ok, work_modes, min_salary
        FROM "JobPreference" WHERE user_id = ${user.id} LIMIT 1
      `;
    } catch {
      // Fallback: try without work_modes in case migration hasn't run yet
      try {
        const rows = await db.$queryRaw<{ titles: string[]; locations: string[]; remote_ok: boolean; min_salary: number | null }[]>`
          SELECT titles, locations, remote_ok, min_salary
          FROM "JobPreference" WHERE user_id = ${user.id} LIMIT 1
        `;
        prefRows = rows.map((r) => ({ ...r, work_modes: [] }));
      } catch {
        prefRows = [];
      }
    }

    return NextResponse.json({
      cv: cvRows[0] ?? null,
      preferences: prefRows[0] ?? null,
      google_connected: dbUser?.google_connected ?? false,
      email_notifications: dbUser?.email_notifications ?? true,
    });
  } catch (err) {
    console.error("[profile GET]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
