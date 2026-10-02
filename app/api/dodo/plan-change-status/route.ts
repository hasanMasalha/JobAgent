import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { getDodo } from "@/lib/dodo";
import { productIdFor, type BillingInterval, type PaidPlan } from "@/lib/plan-limits";

// Payment statuses that mean the plan-change charge will not go through as it stands.
const FAILED_PAYMENT_STATUSES = new Set(["failed", "cancelled", "requires_payment_method"]);

// Whether a plan change requested through /api/dodo/checkout has taken effect, asked of
// Dodo directly: `applied` (the subscription is on the target product), `failed` (the
// charge failed, so Dodo kept the old plan) or `pending`. Read-only — User.plan is still
// written only by the subscription.plan_changed webhook.
export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const plan = req.nextUrl.searchParams.get("plan");
    const interval = req.nextUrl.searchParams.get("interval");
    const paymentId = req.nextUrl.searchParams.get("paymentId");

    if (plan !== "pro" && plan !== "unlimited") {
      return NextResponse.json({ error: "plan must be 'pro' or 'unlimited'" }, { status: 400 });
    }
    if (interval !== "monthly" && interval !== "annual") {
      return NextResponse.json({ error: "interval must be 'monthly' or 'annual'" }, { status: 400 });
    }

    const dodo = getDodo();
    if (!dodo) {
      console.error("[dodo/plan-change-status] DODO_PAYMENTS_API_KEY is not configured");
      return NextResponse.json({ error: "Billing is not configured" }, { status: 500 });
    }

    const productId = productIdFor(plan as PaidPlan, interval as BillingInterval);
    if (!productId) {
      console.error("[dodo/plan-change-status] no product id configured for", plan, interval);
      return NextResponse.json({ error: "Billing is not configured for this plan" }, { status: 500 });
    }

    // The subscription always comes from our own row, never from the request.
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { dodoSubscriptionId: true },
    });
    if (!dbUser?.dodoSubscriptionId) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 });
    }

    const sub = await dodo.subscriptions.retrieve(dbUser.dodoSubscriptionId);
    if (sub.product_id === productId) {
      return NextResponse.json({ status: "applied" });
    }

    if (paymentId) {
      const payment = await dodo.payments.retrieve(paymentId);
      // paymentId comes from the client: only report on a payment that belongs to this
      // user's subscription, or the failure reason of anyone's payment could be read.
      if (payment.subscription_id !== sub.subscription_id) {
        return NextResponse.json({ error: "Payment not found" }, { status: 404 });
      }
      if (payment.status && FAILED_PAYMENT_STATUSES.has(payment.status)) {
        console.error("[dodo/plan-change-status] plan change payment failed", {
          userId: user.id,
          subscriptionId: sub.subscription_id,
          paymentId,
          status: payment.status,
          errorCode: payment.error_code,
          errorMessage: payment.error_message,
        });
        return NextResponse.json({ status: "failed", reason: payment.error_message ?? null });
      }
    }

    // on_hold means a charge on this subscription failed and Dodo is waiting for a new
    // payment method — the change is not going to apply by itself.
    if (sub.status === "on_hold") {
      return NextResponse.json({ status: "failed", reason: null });
    }

    return NextResponse.json({ status: "pending", scheduled: sub.scheduled_change?.product_id === productId });
  } catch (err) {
    console.error("[dodo/plan-change-status GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
