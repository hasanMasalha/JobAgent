import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function GET() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { google_access_token: true, google_connected: true },
  });

  const connected = !!(dbUser?.google_connected && dbUser?.google_access_token);

  let email: string | null = null;
  if (connected && dbUser?.google_access_token) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/oauth2/v1/userinfo?access_token=${dbUser.google_access_token}`
      );
      if (res.ok) {
        const data = await res.json();
        email = data.email ?? null;
      }
    } catch { /* ignore — email is best-effort */ }
  }

  return NextResponse.json({ connected, email });
}
