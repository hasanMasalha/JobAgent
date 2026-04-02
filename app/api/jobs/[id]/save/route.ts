import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await db.$executeRaw`
      INSERT INTO "UserJobInteraction" (id, user_id, job_id, action)
      VALUES (gen_random_uuid(), ${user.id}, ${params.id}, 'saved')
      ON CONFLICT (user_id, job_id) DO UPDATE SET action = 'saved'
    `;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[jobs/save]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
