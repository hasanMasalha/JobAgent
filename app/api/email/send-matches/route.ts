import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendDailyMatchEmail } from "@/lib/email";

function isAuthorized(req: NextRequest): boolean {
  // Allow calls from localhost
  const forwarded = req.headers.get("x-forwarded-for");
  const host = req.headers.get("host") ?? "";
  const isLocal =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    forwarded === "127.0.0.1";

  // Allow calls with matching internal key
  const internalKey = req.headers.get("x-internal-key");
  const hasValidKey =
    !!process.env.INTERNAL_API_KEY &&
    internalKey === process.env.INTERNAL_API_KEY;

  return isLocal || hasValidKey;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { user_id } = await req.json();
    if (!user_id) {
      return NextResponse.json({ error: "user_id required" }, { status: 400 });
    }

    // Check email_notifications is enabled for this user
    const userRow = await db.$queryRaw<
      { email_notifications: boolean }[]
    >`SELECT email_notifications FROM "User" WHERE id = ${user_id} LIMIT 1`;

    if (!userRow.length || userRow[0].email_notifications === false) {
      return NextResponse.json({ success: true, skipped: "notifications_off" });
    }

    // Get user email + name from DB
    const userRow2 = await db.$queryRaw<{ email: string; name: string | null }[]>`
      SELECT email, name FROM "User" WHERE id = ${user_id} LIMIT 1
    `;
    if (!userRow2.length) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const userEmail = userRow2[0].email;
    const userName = userRow2[0].name ?? "";

    // Get today's matches — jobs scraped in the last 24h not yet dismissed or applied
    const matches = await db.$queryRaw<
      {
        id: string;
        title: string;
        company: string;
        location: string | null;
        url: string;
        salary_min: number | null;
        salary_max: number | null;
      }[]
    >`
      SELECT j.id, j.title, j.company, j.location, j.url, j.salary_min, j.salary_max
      FROM "Job" j
      WHERE j.scraped_at >= now() - interval '24 hours'
        AND j.id NOT IN (
          SELECT job_id FROM "UserJobInteraction"
          WHERE user_id = ${user_id}
        )
        AND j.id NOT IN (
          SELECT job_id FROM "Application"
          WHERE user_id = ${user_id}
        )
      ORDER BY j.scraped_at DESC
      LIMIT 20
    `;

    if (!matches.length) {
      return NextResponse.json({ success: true, skipped: "no_new_matches" });
    }

    // Use a flat score of 75 for newly scraped jobs (full scoring happens via /match-jobs)
    // If match_cache is available we could use those scores — keeping it simple here
    const topMatches = matches.slice(0, 5).map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location ?? "Israel",
      score: 75,
      url: j.url,
    }));

    await sendDailyMatchEmail({
      userEmail,
      userName,
      matchCount: matches.length,
      topMatches,
    });

    return NextResponse.json({ success: true, sent_to: userEmail, match_count: matches.length });
  } catch (err) {
    console.error("[email/send-matches]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
