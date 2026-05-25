import { createServerClient } from "@/lib/supabase.server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  if (code) {
    const supabase = createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${appUrl}/dashboard`);
    }
  }

  return NextResponse.redirect(`${appUrl}/login?error=auth`);
}
