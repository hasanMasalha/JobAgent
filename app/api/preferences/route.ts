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

    const { email_notifications } = await req.json();

    if (typeof email_notifications !== "boolean") {
      return NextResponse.json({ error: "email_notifications must be a boolean" }, { status: 400 });
    }

    await db.$executeRaw`
      UPDATE "User" SET email_notifications = ${email_notifications}
      WHERE id = ${user.id}
    `;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[preferences PATCH]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
