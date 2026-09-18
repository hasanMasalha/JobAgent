import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { dodo } from "@/lib/dodo";
import { productIdFor, type BillingInterval, type PaidPlan } from "@/lib/plan-limits";

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

    const productId = productIdFor(plan as PaidPlan, interval as BillingInterval);
    if (!productId) {
      console.error("[dodo/checkout] no product id configured for", plan, interval);
      return NextResponse.json({ error: "Billing is not configured for this plan" }, { status: 500 });
    }

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { email: true, name: true, dodoCustomerId: true },
    });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

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
