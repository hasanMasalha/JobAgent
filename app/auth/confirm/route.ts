import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { safeNextPath } from "@/lib/safe-next";

// Landing route for Supabase email links (password reset). The email template
// links here with the token hash, so verifying works on any device — unlike
// the PKCE ?code= flow through /auth/callback, which only works in the browser
// that requested the email. Supabase → Auth → Email Templates → Reset Password:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  if (tokenHash && type) {
    const supabase = createServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${appUrl}${next}`);
  }

  const failed = type === "recovery" ? "/forgot-password?error=expired" : "/login?error=auth";
  return NextResponse.redirect(`${appUrl}${failed}`);
}
