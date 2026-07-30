import { NextRequest, NextResponse } from "next/server";
import { EventName, type SubscriptionNotification, type TransactionNotification } from "@paddle/paddle-node-sdk";
import { db } from "@/lib/db";
import { paddle } from "@/lib/paddle";
import { planFromPriceId, type PaidPlan } from "@/lib/plan-limits";

// customData.userId (set when we create the checkout transaction) is the primary way to
// identify the user — it's exact. Falling back to a Paddle customer-email lookup covers
// subscriptions Paddle created outside our checkout flow (e.g. dashboard-created test subs).
async function resolveUserId(
  customerId: string,
  customData: Record<string, unknown> | null
): Promise<string | null> {
  const userIdFromCustomData = typeof customData?.userId === "string" ? customData.userId : null;
  if (userIdFromCustomData) {
    const match = await db.user.findUnique({ where: { id: userIdFromCustomData }, select: { id: true } });
    if (match) return match.id;
  }

  try {
    const customer = await paddle.customers.get(customerId);
    const byEmail = await db.user.findUnique({ where: { email: customer.email }, select: { id: true } });
    return byEmail?.id ?? null;
  } catch (err) {
    console.error("[paddle/webhook] failed to look up Paddle customer", customerId, err);
    return null;
  }
}

function planFromSubscription(sub: SubscriptionNotification): PaidPlan | null {
  for (const item of sub.items) {
    const plan = planFromPriceId(item.price?.id);
    if (plan) return plan;
  }
  return null;
}

async function handleSubscriptionUpsert(sub: SubscriptionNotification) {
  const plan = planFromSubscription(sub);
  const userId = await resolveUserId(sub.customerId, sub.customData);

  if (!userId || !plan) {
    console.error("[paddle/webhook] could not resolve user/plan for subscription", sub.id, { userId, plan });
    return;
  }

  await db.user.update({
    where: { id: userId },
    data: {
      plan,
      paddleCustomerId: sub.customerId,
      paddleSubscriptionId: sub.id,
      planExpiresAt: sub.currentBillingPeriod?.endsAt ? new Date(sub.currentBillingPeriod.endsAt) : null,
    },
  });
}

async function handleSubscriptionCanceled(sub: SubscriptionNotification) {
  const linked = await db.user.findFirst({
    where: { paddleSubscriptionId: sub.id },
    select: { id: true },
  });
  const userId = linked?.id ?? (await resolveUserId(sub.customerId, sub.customData));

  if (!userId) {
    console.error("[paddle/webhook] could not resolve user for canceled subscription", sub.id);
    return;
  }

  await db.user.update({
    where: { id: userId },
    data: { plan: "free", paddleSubscriptionId: null, planExpiresAt: null },
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[paddle/webhook] PADDLE_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = req.headers.get("paddle-signature");
  // Signature is an HMAC over the raw bytes — must read as text, not req.json().
  const rawBody = await req.text();

  if (!signature) {
    return NextResponse.json({ error: "Missing paddle-signature header" }, { status: 400 });
  }

  let event;
  try {
    event = await paddle.webhooks.unmarshal(rawBody, secret, signature);
  } catch (err) {
    console.error("[paddle/webhook] signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    switch (event.eventType) {
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated:
        await handleSubscriptionUpsert(event.data);
        break;

      case EventName.SubscriptionCanceled:
        await handleSubscriptionCanceled(event.data);
        break;

      case EventName.TransactionCompleted: {
        const txn: TransactionNotification = event.data;
        console.log("[paddle/webhook] transaction completed", {
          id: txn.id,
          customerId: txn.customerId,
          subscriptionId: txn.subscriptionId,
          customData: txn.customData,
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("[paddle/webhook] handler error for event", event.eventType, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
