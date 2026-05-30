import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const row = await db.application.findFirst({
      where: { id: params.id, user_id: user.id },
      select: { status: true },
    });

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ status: row.status });
  } catch (err) {
    console.error("[applications/status GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const ALLOWED_STATUSES = ["applied", "interviewing", "offer", "rejected"] as const;
type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

export async function PATCH(
  req: NextRequest,
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

    const body = await req.json();
    const { status } = body;

    if (!ALLOWED_STATUSES.includes(status as AllowedStatus)) {
      return NextResponse.json(
        { error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}` },
        { status: 422 }
      );
    }

    const updated = await db.application.updateMany({
      where: { id: params.id, user_id: user.id },
      data: { status },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[applications/status PATCH]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
