import { createServerClient } from "@/lib/supabase.server";
import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/safe-next";

// OAuth and PKCE email links land here with ?code=. `next` lets a password
// reset continue to /reset-password; it's allow-listed (lib/safe-next.ts).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  if (code) {
    const supabase = createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${appUrl}${next}`);
    }
  }

  const failed = next === "/reset-password" ? "/forgot-password?error=expired" : "/login?error=auth";
  return NextResponse.redirect(`${appUrl}${failed}`);
}
