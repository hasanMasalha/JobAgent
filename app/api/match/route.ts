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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    let pythonRes: Response;
    try {
      pythonRes = await fetch(
        `${process.env.PYTHON_SERVICE_URL}/match-jobs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: user.id, force_refresh }),
          signal: controller.signal,
        }
      );
    } catch (fetchErr) {
      clearTimeout(timeout);
      const label = fetchErr instanceof Error && fetchErr.name === "AbortError"
        ? "[match] Python service timeout"
        : `[match] Python service unreachable: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}`;
      console.error(label);
      return NextResponse.json(
        { error: "Matching service unavailable. Try again in a moment.", jobs: [], total: 0, page, limit, hasMore: false },
        { status: 200 }
      );
    }
    clearTimeout(timeout);

    if (!pythonRes.ok) {
      const errText = await pythonRes.text().catch(() => "");
      console.error("[match] Python service error:", pythonRes.status, errText.substring(0, 200));
      return NextResponse.json(
        { error: "Matching service unavailable. Try again in a moment.", jobs: [], total: 0, page, limit, hasMore: false },
        { status: 200 }
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
    console.error("[match] Unexpected error:", err);
    return NextResponse.json(
      { error: "Matching service unavailable. Try again in a moment.", jobs: [], total: 0, hasMore: false },
      { status: 200 }
    );
  }
}
