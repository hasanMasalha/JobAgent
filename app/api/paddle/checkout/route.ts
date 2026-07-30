import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { priceIdFor, type BillingInterval, type PaidPlan } from "@/lib/plan-limits";

// Paddle's server-side Transactions API has no per-request success/cancel URL field
// (confirmed against the SDK types and https://developer.paddle.com/api-reference/transactions/create-transaction —
// checkout.url only overrides the checkout domain, it isn't a post-payment redirect).
// Redirect control only exists in the Paddle.js checkout overlay's `settings.successUrl`,
// so this route just resolves what the frontend needs to open that overlay itself.
export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { plan, interval } = body as { plan?: string; interval?: string };

    if (plan !== "pro" && plan !== "unlimited") {
      return NextResponse.json({ error: "plan must be 'pro' or 'unlimited'" }, { status: 400 });
    }
    if (interval !== "monthly" && interval !== "annual") {
      return NextResponse.json({ error: "interval must be 'monthly' or 'annual'" }, { status: 400 });
    }

    const priceId = priceIdFor(plan as PaidPlan, interval as BillingInterval);
    if (!priceId) {
      console.error("[paddle/checkout] no price id configured for", plan, interval);
      return NextResponse.json({ error: "Billing is not configured for this plan" }, { status: 500 });
    }

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { email: true, paddleCustomerId: true },
    });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json({
      priceId,
      // Reuse the existing Paddle customer if we have one; otherwise the overlay
      // creates one from the email — the webhook backfills paddleCustomerId either way.
      customerId: dbUser.paddleCustomerId ?? null,
      customerEmail: dbUser.email ?? user.email ?? null,
      userId: user.id,
      plan,
      interval,
    });
  } catch (err) {
    console.error("[paddle/checkout POST]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
