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
        title: string;
        company: string;
        location: string | null;
        url: string;
        salary_min: number | null;
        salary_max: number | null;
        scraped_at: Date;
      }[]
    >`
      SELECT j.id, j.title, j.company, j.location, j.url,
             j.salary_min, j.salary_max, j.scraped_at
      FROM "UserJobInteraction" i
      JOIN "Job" j ON j.id = i.job_id
      WHERE i.user_id = ${user.id} AND i.action = 'saved'
      ORDER BY j.scraped_at DESC
    `;

    return NextResponse.json({ jobs: rows });
  } catch (err) {
    console.error("[jobs/saved]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
