import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { getDodo } from "@/lib/dodo";
import { normalizePlan, planRank, productIdFor, type BillingInterval, type PaidPlan } from "@/lib/plan-limits";

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

    const dodo = getDodo();
    if (!dodo) {
      console.error("[dodo/checkout] DODO_PAYMENTS_API_KEY is not configured");
      return NextResponse.json({ error: "Billing is not configured" }, { status: 500 });
    }

    const productId = productIdFor(plan as PaidPlan, interval as BillingInterval);
    if (!productId) {
      console.error("[dodo/checkout] no product id configured for", plan, interval);
      return NextResponse.json({ error: "Billing is not configured for this plan" }, { status: 500 });
    }

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { email: true, name: true, dodoCustomerId: true, plan: true, dodoSubscriptionId: true },
    });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Existing subscribers must never get a second checkout — that creates a parallel
    // subscription and a duplicate charge. Change the existing subscription instead.
    const currentPlan = normalizePlan(dbUser.plan);
    if (currentPlan !== "free") {
      if (!dbUser.dodoSubscriptionId) {
        console.error("[dodo/checkout] paid plan without a subscription id for user", user.id);
        return NextResponse.json(
          { error: "We couldn't find your subscription. Please contact support." },
          { status: 409 }
        );
      }

      const sub = await dodo.subscriptions.retrieve(dbUser.dodoSubscriptionId);
      if (sub.product_id === productId) {
        return NextResponse.json({ error: "You're already on this plan" }, { status: 409 });
      }

      // Higher tier, or same tier switching monthly → annual, applies now; anything
      // else (lower tier, annual → monthly) waits for the next billing date so the
      // customer keeps what they've paid for.
      const rankDiff = planRank(plan as PaidPlan) - planRank(currentPlan);
      const immediate = rankDiff > 0 || (rankDiff === 0 && interval === "annual");

      await dodo.subscriptions.changePlan(dbUser.dodoSubscriptionId, {
        product_id: productId,
        quantity: 1,
        proration_billing_mode: "prorated_immediately",
        effective_at: immediate ? "immediately" : "next_billing_date",
        on_payment_failure: "prevent_change",
      });

      // The subscription.plan_changed webhook updates User.plan; don't write it here.
      return NextResponse.json({ changed: true, effective: immediate ? "immediately" : "next_billing_date" });
    }

    const email = dbUser.email ?? user.email;
    if (!dbUser.dodoCustomerId && !email) {
      return NextResponse.json({ error: "No email on file for checkout" }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

    const session = await dodo.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      // Reuse the existing Dodo customer if we have one; otherwise the session
      // creates one from the email — the webhook backfills dodoCustomerId either way.
      customer: dbUser.dodoCustomerId
        ? { customer_id: dbUser.dodoCustomerId }
        : { email: email!, name: dbUser.name ?? undefined },
      metadata: { userId: user.id, plan, interval },
      return_url: `${appUrl}/dashboard?upgraded=true`,
    });

    if (!session.checkout_url) {
      console.error("[dodo/checkout] session created with no checkout_url", session.session_id);
      return NextResponse.json({ error: "Checkout session did not return a URL" }, { status: 502 });
    }

    return NextResponse.json({ checkoutUrl: session.checkout_url });
  } catch (err) {
    console.error("[dodo/checkout POST]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
