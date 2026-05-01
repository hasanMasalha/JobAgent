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

    const rows = await db.$queryRaw<
      {
        id: string;
        status: string;
        applied_at: Date;
        cover_letter: string | null;
        has_tailored_cv: boolean;
        job_title: string;
        company: string;
        job_url: string;
        location: string | null;
      }[]
    >`
      SELECT
        a.id,
        a.status,
        a.applied_at,
        a.cover_letter,
        (a.tailored_cv IS NOT NULL AND a.tailored_cv <> '') AS has_tailored_cv,
        j.title  AS job_title,
        j.company,
        j.url    AS job_url,
        j.location
      FROM "Application" a
      LEFT JOIN "Job" j ON j.id = a.job_id
      WHERE a.user_id = ${user.id}
      ORDER BY a.applied_at DESC
    `;

    return NextResponse.json({ applications: rows });
  } catch (err) {
    console.error("[applications]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
