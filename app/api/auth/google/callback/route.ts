import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const dashboardUrl = new URL("/dashboard", req.url);

  if (error || !code) {
    dashboardUrl.searchParams.set("toast", "google_error");
    return NextResponse.redirect(dashboardUrl);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      throw new Error("Token exchange failed");
    }

    const tokens = await tokenRes.json();
    const { access_token, refresh_token } = tokens;

    // Get authenticated user
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      dashboardUrl.searchParams.set("toast", "google_error");
      return NextResponse.redirect(dashboardUrl);
    }

    // Save tokens to users table
    await db.user.update({
      where: { id: user.id },
      data: {
        google_access_token: access_token,
        google_refresh_token: refresh_token ?? undefined,
        google_connected: true,
      },
    });

    dashboardUrl.searchParams.set("toast", "google_connected");
    return NextResponse.redirect(dashboardUrl);
  } catch (err) {
    console.error("[google/callback]", err);
    dashboardUrl.searchParams.set("toast", "google_error");
    return NextResponse.redirect(dashboardUrl);
  }
}
