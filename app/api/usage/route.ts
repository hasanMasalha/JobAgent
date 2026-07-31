import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { normalizePlan } from "@/lib/plan-limits";
import { getUserUsageSummary } from "@/lib/usage";

export async function GET() {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { plan: true } });
    const plan = normalizePlan(dbUser?.plan);

    const summary = await getUserUsageSummary(user.id, plan);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[usage GET]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
