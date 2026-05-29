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

    const { applicationId, status } = await req.json();
    if (!applicationId || !status) {
      return NextResponse.json({ error: "applicationId and status required" }, { status: 400 });
    }

    const allowed = ["applied", "manual", "failed"];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await db.$executeRaw`
      UPDATE "Application"
      SET status = ${status}
      WHERE id = ${applicationId} AND user_id = ${user.id}
    `;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[applications/update-status]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
