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

    const form = await req.formData();
    const titles: string[] = JSON.parse((form.get("titles") as string) ?? "[]");
    const location = (form.get("location") as string) ?? "";
    const remoteOk = form.get("remote_ok") === "true";
    const minSalaryRaw = form.get("min_salary") as string;
    const minSalary = minSalaryRaw ? parseInt(minSalaryRaw) : null;

    await db.$executeRaw`
      INSERT INTO "JobPreference" (id, user_id, titles, locations, remote_ok, min_salary, updated_at)
      VALUES (gen_random_uuid(), ${user.id}, ${titles}::text[], ARRAY[${location}]::text[],
              ${remoteOk}, ${minSalary}, now())
      ON CONFLICT (user_id) DO UPDATE
        SET titles     = EXCLUDED.titles,
            locations  = EXCLUDED.locations,
            remote_ok  = EXCLUDED.remote_ok,
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
