import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const cookie: string = (body.cookie ?? "").trim();
  if (!cookie) {
    return NextResponse.json({ error: "cookie is required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${process.env.PYTHON_SERVICE_URL}/linkedin/save-cookie`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, cookie }),
      }
    );

    const data = await res.json();
    if (!res.ok || !data.success) {
      return NextResponse.json(
        { error: data.error ?? "Failed to save cookie" },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[linkedin/start-session]", err);
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
}
