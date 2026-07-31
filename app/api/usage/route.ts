import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import {
  getMonthlyAutoApplyLimit,
  getDailyMatchLimit,
  startOfCurrentMonth,
  startOfTodayUTC,
} from "@/lib/plan-limits";

export async function GET() {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { plan: true } });
    const plan = dbUser?.plan ?? "free";
    const limit = getMonthlyAutoApplyLimit(plan);

    const used = await db.application.count({
      where: { user_id: user.id, applied_at: { gte: startOfCurrentMonth() } },
    });

    const matchesLimit = getDailyMatchLimit(plan);
    let matchesUsed = 0;
    if (matchesLimit !== null) {
      const usageRow = await db.dailyMatchUsage.findUnique({
        where: { user_id_date: { user_id: user.id, date: startOfTodayUTC() } },
      });
      matchesUsed = Array.isArray(usageRow?.job_ids) ? usageRow!.job_ids.length : 0;
    }

    return NextResponse.json({ plan, used, limit, matchesUsed, matchesLimit });
  } catch (err) {
    console.error("[usage GET]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
