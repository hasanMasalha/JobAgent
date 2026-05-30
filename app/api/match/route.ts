import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { detectApplyType, extractRecruiterEmail } from "@/lib/detect-apply-type";

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const force_refresh = url.searchParams.get("refresh") === "true";
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));

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

    const rawJobs = await pythonRes.json();
    const enriched = rawJobs.map((j: Record<string, unknown>) => ({
      ...j,
      apply_type: (j.apply_type as string) ?? detectApplyType({
        url: j.url as string,
        source: j.source as string,
        description: j.description as string,
      }),
      recruiter_email: (j.recruiter_email as string) ?? extractRecruiterEmail(j.description as string ?? ""),
    }));
    const start = (page - 1) * limit;
    const jobs = enriched.slice(start, start + limit);

    return NextResponse.json({
      jobs,
      total: enriched.length,
      page,
      limit,
      hasMore: start + limit < enriched.length,
    });
  } catch (err) {
    console.error("[match]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
