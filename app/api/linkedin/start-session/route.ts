import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";

export async function POST() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const res = await fetch(
      `${process.env.PYTHON_SERVICE_URL}/linkedin/start-login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id }),
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: "Python service error" }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[linkedin/start-session]", err);
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
}
