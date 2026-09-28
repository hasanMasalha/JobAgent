import { createServerClient } from "@/lib/supabase.server";
import { NextResponse } from "next/server";
import { createExtensionToken } from "@/lib/extension-token";

export async function GET() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    // The Chrome extension's auth-sync script stores this and sends it as a
    // Bearer token to the routes its service worker calls. See lib/extension-token.ts.
    extensionToken: createExtensionToken(user.id),
  });
}
