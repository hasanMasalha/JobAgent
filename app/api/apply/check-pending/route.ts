import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ pending: false });

  const { searchParams } = new URL(request.url);
  const jobUrl = searchParams.get("jobUrl");
  if (!jobUrl) return NextResponse.json({ pending: false });

  // Find pending application for this job URL
  const rows = await db.$queryRaw<
    {
      id: string;
      job_url: string;
    }[]
  >`
    SELECT a.id, j.url AS job_url
    FROM "Application" a
    JOIN "Job" j ON j.id = a.job_id
    WHERE a.user_id = ${user.id}
      AND a.status = 'pending_extension'
      AND j.url = ${jobUrl}
    LIMIT 1
  `;

  if (!rows.length) return NextResponse.json({ pending: false });

  // Get user CV skills for form filling
  const cvRows = await db.$queryRaw<{ skills_json: unknown }[]>`
    SELECT skills_json FROM "CV" WHERE user_id = ${user.id} LIMIT 1
  `;

  const skills: string[] = (() => {
    const raw = cvRows[0]?.skills_json;
    if (Array.isArray(raw)) return raw as string[];
    return [];
  })();

  return NextResponse.json({
    pending: true,
    application: {
      id: rows[0].id,
      jobUrl: rows[0].job_url,
      skills,
      // Fields not yet in schema — extension handles gracefully when null
      phone: null,
      city: null,
      linkedin_url: null,
      expected_salary: null,
      notice_period: null,
    },
  });
}
