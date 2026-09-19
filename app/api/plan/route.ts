import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { getDodo } from "@/lib/dodo";
import { intervalFromProductId, normalizePlan } from "@/lib/plan-limits";

// Current plan + billing interval, so pricing/onboarding can render Current plan / Upgrade / Downgrade.
export async function GET() {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { plan: true, dodoSubscriptionId: true },
    });
    const plan = normalizePlan(dbUser?.plan);

    // The interval lives on the Dodo subscription's product, not in our DB. Best-effort:
    // if Dodo is unreachable the UI just can't distinguish monthly from annual.
    let interval: "monthly" | "annual" | null = null;
    const dodo = getDodo();
    if (plan !== "free" && dbUser?.dodoSubscriptionId && dodo) {
      try {
        const sub = await dodo.subscriptions.retrieve(dbUser.dodoSubscriptionId);
        interval = intervalFromProductId(sub.product_id);
      } catch (err) {
        console.error("[plan GET] could not retrieve subscription", err);
      }
    }

    return NextResponse.json({ plan, interval });
  } catch (err) {
    console.error("[plan GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
