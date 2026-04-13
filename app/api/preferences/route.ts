import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    // Update email_notifications on User row
    if (typeof body.email_notifications === "boolean") {
      await db.$executeRaw`
        UPDATE "User" SET email_notifications = ${body.email_notifications}
        WHERE id = ${user.id}
      `;
    }

    // Update job preferences
    if (body.job_preferences !== undefined) {
      const { titles, locations, remote_ok, min_salary } = body.job_preferences as {
        titles: string[];
        locations: string[];
        remote_ok: boolean;
        min_salary: number | null;
      };

      await db.$executeRaw`
        INSERT INTO "JobPreference" (id, user_id, titles, locations, remote_ok, min_salary, updated_at)
        VALUES (gen_random_uuid(), ${user.id}, ${titles}::text[], ${locations}::text[],
                ${remote_ok}, ${min_salary}, now())
        ON CONFLICT (user_id) DO UPDATE
          SET titles     = EXCLUDED.titles,
              locations  = EXCLUDED.locations,
              remote_ok  = EXCLUDED.remote_ok,
              min_salary = EXCLUDED.min_salary,
              updated_at = now()
      `;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[preferences PATCH]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
