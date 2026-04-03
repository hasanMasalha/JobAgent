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

    const { job_id, action } = await req.json();
    if (!job_id || !["saved", "dismissed"].includes(action)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    await db.$executeRaw`
      INSERT INTO "UserJobInteraction" (id, user_id, job_id, action)
      VALUES (gen_random_uuid(), ${user.id}, ${job_id}, ${action})
      ON CONFLICT (user_id, job_id) DO UPDATE SET action = ${action}
    `;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[jobs/interact]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { job_id } = await req.json();
    if (!job_id) {
      return NextResponse.json({ error: "job_id required" }, { status: 400 });
    }

    await db.$executeRaw`
      DELETE FROM "UserJobInteraction"
      WHERE user_id = ${user.id} AND job_id = ${job_id} AND action = 'saved'
    `;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[jobs/interact DELETE]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
