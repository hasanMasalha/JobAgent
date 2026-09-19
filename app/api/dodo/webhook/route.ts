import { NextRequest, NextResponse } from "next/server";
import DodoPayments from "dodopayments";
import { db } from "@/lib/db";
import { getDodo } from "@/lib/dodo";
import { planFromProductId, type PaidPlan } from "@/lib/plan-limits";

type Subscription = DodoPayments.Subscription;

// event.data.metadata.userId (set when we create the checkout session) is the primary way
// to identify the user — it's exact. Falling back to a Dodo customer-email lookup covers
// subscriptions Dodo created outside our checkout flow (e.g. dashboard-created test subs).
async function resolveUserId(
  customerEmail: string,
  metadata: Record<string, string | number | boolean>
): Promise<string | null> {
  const userIdFromMetadata = typeof metadata.userId === "string" ? metadata.userId : null;
  if (userIdFromMetadata) {
    const match = await db.user.findUnique({ where: { id: userIdFromMetadata }, select: { id: true } });
    if (match) return match.id;
  }

  const byEmail = await db.user.findUnique({ where: { email: customerEmail }, select: { id: true } });
  return byEmail?.id ?? null;
}

function planFromSubscription(sub: Subscription): PaidPlan | null {
  return planFromProductId(sub.product_id);
}

async function handleSubscriptionUpsert(sub: Subscription) {
  const plan = planFromSubscription(sub);
  const userId = await resolveUserId(sub.customer.email, sub.metadata);

  if (!userId || !plan) {
    console.error("[dodo/webhook] could not resolve user/plan for subscription", sub.subscription_id, { userId, plan });
    return;
  }

  await db.user.update({
    where: { id: userId },
    data: {
      plan,
      dodoCustomerId: sub.customer.customer_id,
      dodoSubscriptionId: sub.subscription_id,
      planExpiresAt: sub.next_billing_date ? new Date(sub.next_billing_date) : null,
    },
  });
}

async function handleSubscriptionDowngrade(sub: Subscription) {
  const linked = await db.user.findFirst({
    where: { dodoSubscriptionId: sub.subscription_id },
    select: { id: true },
  });
  const userId = linked?.id ?? (await resolveUserId(sub.customer.email, sub.metadata));

  if (!userId) {
    console.error("[dodo/webhook] could not resolve user for downgraded subscription", sub.subscription_id);
    return;
  }

  await db.user.update({
    where: { id: userId },
    data: { plan: "free", dodoSubscriptionId: null, planExpiresAt: null },
  });
}

export async function POST(req: NextRequest) {
  if (!process.env.DODO_PAYMENTS_WEBHOOK_KEY) {
    console.error("[dodo/webhook] DODO_PAYMENTS_WEBHOOK_KEY is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const dodo = getDodo();
  if (!dodo) {
    console.error("[dodo/webhook] DODO_PAYMENTS_API_KEY is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // Signature is an HMAC over the raw bytes — must read as text, not req.json().
  const rawBody = await req.text();
  const headers = {
    "webhook-id": req.headers.get("webhook-id") ?? "",
    "webhook-signature": req.headers.get("webhook-signature") ?? "",
    "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
  };

  if (!headers["webhook-id"] || !headers["webhook-signature"] || !headers["webhook-timestamp"]) {
    return NextResponse.json({ error: "Missing webhook headers" }, { status: 400 });
  }

  let event;
  try {
    event = dodo.webhooks.unwrap(rawBody, { headers });
  } catch (err) {
    console.error("[dodo/webhook] signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    switch (event.type) {
      case "subscription.active":
      case "subscription.renewed":
      case "subscription.updated":
      case "subscription.plan_changed":
        await handleSubscriptionUpsert(event.data);
        break;

      case "subscription.cancelled":
        // A scheduled cancellation (cancel at period end) keeps the plan active
        // until subscription.expired actually fires; only an immediate
        // cancellation downgrades right away.
        if (!event.data.cancel_at_next_billing_date) {
          await handleSubscriptionDowngrade(event.data);
        }
        break;

      case "subscription.expired":
        await handleSubscriptionDowngrade(event.data);
        break;

      case "refund.succeeded": {
        // Deliberately no plan change. A refund doesn't cancel the Dodo subscription, so it
        // keeps billing and the next subscription.renewed would restore the plan anyway.
        // Whether to revoke access (and cancel the subscription) is a manual decision.
        const refund = event.data;
        console.warn(
          "[dodo/webhook] refund.succeeded — NO plan change made, manual review needed",
          { refundId: refund.refund_id, paymentId: refund.payment_id, customerId: refund.customer.customer_id, amount: refund.amount }
        );
        break;
      }

      default:
        // Acknowledged (200) but not acted on — log so gaps like this stay visible.
        console.warn("[dodo/webhook] received event with no handler", {
          type: event.type,
          webhookId: headers["webhook-id"],
        });
        break;
    }
  } catch (err) {
    console.error("[dodo/webhook] handler error for event", event.type, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
