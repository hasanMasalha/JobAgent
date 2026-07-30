import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { paddle } from "@/lib/paddle";
import { priceIdFor, type BillingInterval, type PaidPlan } from "@/lib/plan-limits";

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
      select: { email: true, name: true, paddleCustomerId: true },
    });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Reuse the existing Paddle customer if we've checked out before, otherwise create one.
    let customerId = dbUser.paddleCustomerId;
    if (!customerId) {
      const customer = await paddle.customers.create({
        email: dbUser.email ?? user.email!,
        name: dbUser.name ?? undefined,
      });
      customerId = customer.id;
      await db.user.update({
        where: { id: user.id },
        data: { paddleCustomerId: customerId },
      });
    }

    // customData carries our internal user id through to the webhook, which is a more
    // reliable way to identify the user than the email match Paddle's payload otherwise requires.
    const transaction = await paddle.transactions.create({
      items: [{ priceId, quantity: 1 }],
      customerId,
      customData: { userId: user.id, plan, interval },
    });

    const url = transaction.checkout?.url;
    if (!url) {
      console.error("[paddle/checkout] transaction created with no checkout url", transaction.id);
      return NextResponse.json({ error: "Paddle did not return a checkout URL" }, { status: 502 });
    }

    // Paddle's hosted checkout redirects back to the "Default payment link" configured in
    // Paddle Dashboard → Checkout → Checkout settings (this SDK's Transactions API has no
    // per-request success/cancel URL field) — set that to https://jobagent.uk/dashboard?upgraded=true.
    // There is no cancel callback for hosted checkout; the user simply closes/backs out to
    // wherever they came from (https://jobagent.uk/pricing in our flow).
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[paddle/checkout POST]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
