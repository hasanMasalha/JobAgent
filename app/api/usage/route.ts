import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { getMonthlyAutoApplyLimit, startOfCurrentMonth } from "@/lib/plan-limits";

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

    return NextResponse.json({ plan, used, limit });
  } catch (err) {
    console.error("[usage GET]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
