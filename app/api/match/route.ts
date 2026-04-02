import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const force_refresh = new URL(req.url).searchParams.get("refresh") === "true";

    const pythonRes = await fetch(
      `${process.env.PYTHON_SERVICE_URL}/match-jobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, force_refresh }),
        signal: AbortSignal.timeout(120_000),
      }
    );

    if (!pythonRes.ok) {
      const err = await pythonRes.text();
      return NextResponse.json(
        { error: `Matching error: ${err}` },
        { status: 500 }
      );
    }

    const jobs = await pythonRes.json();
    return NextResponse.json({ jobs });
  } catch (err) {
    console.error("[match]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
