import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const titles: string[] = Array.isArray(body.titles) ? body.titles : [];
    const locations: string[] = Array.isArray(body.locations) ? body.locations : (body.location ? [body.location] : []);
    const remoteOk: boolean = body.remote_ok === true;
    const workModes: string[] = Array.isArray(body.work_modes) ? body.work_modes : [];
    const minSalary: number | null = body.min_salary ? parseInt(body.min_salary) : null;

    await db.$executeRaw`
      INSERT INTO "JobPreference" (id, user_id, titles, locations, remote_ok, work_modes, min_salary, updated_at)
      VALUES (gen_random_uuid(), ${user.id}, ${titles}::text[], ${locations}::text[],
              ${remoteOk}, ${workModes}::text[], ${minSalary}, now())
      ON CONFLICT (user_id) DO UPDATE
        SET titles     = EXCLUDED.titles,
            locations  = EXCLUDED.locations,
            remote_ok  = EXCLUDED.remote_ok,
            work_modes = EXCLUDED.work_modes,
            min_salary = EXCLUDED.min_salary,
            updated_at = now()
    `;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[profile/preferences POST]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
