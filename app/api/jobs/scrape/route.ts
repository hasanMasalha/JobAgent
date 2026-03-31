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

  try {
    const pythonRes = await fetch(
      `${process.env.PYTHON_SERVICE_URL}/scrape-and-store`,
      {
        method: "POST",
        signal: AbortSignal.timeout(300_000), // 5 min — scraping takes time
      }
    );

    if (!pythonRes.ok) {
      const err = await pythonRes.text();
      return NextResponse.json(
        { error: `Scraper error: ${err}` },
        { status: 500 }
      );
    }

    const result = await pythonRes.json();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[jobs/scrape]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
