import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";

export async function GET() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const res = await fetch(
      `${process.env.PYTHON_SERVICE_URL}/linkedin/login-poll/${user.id}`
    );

    if (!res.ok) {
      return NextResponse.json({ connected: false, login_status: null });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ connected: false, login_status: null });
  }
}
