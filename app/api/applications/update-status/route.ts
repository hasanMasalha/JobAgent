import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { applicationId, status, userId: bodyUserId } = await req.json();

    // Accept userId from request body when called from background.js service worker
    // (SameSite=Lax prevents session cookies from being sent in that context)
    const userId = user?.id ?? bodyUserId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!applicationId || !status) {
      return NextResponse.json({ error: "applicationId and status required" }, { status: 400 });
    }

    const allowed = ["applied", "manual", "failed"];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    console.log("[update-status] updating:", applicationId, "to:", status, "for user:", userId);
    await db.$executeRaw`
      UPDATE "Application"
      SET status = ${status}
      WHERE id = ${applicationId} AND user_id = ${userId}
    `;
    console.log("[update-status] done");

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[applications/update-status]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
