import { NextRequest, NextResponse } from "next/server";
import DodoPayments from "dodopayments";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getDodo } from "@/lib/dodo";
import { planFromProductId, type PaidPlan } from "@/lib/plan-limits";
import { sendSubscriptionWelcomeEmail, sendPlanChangedEmail, sendSubscriptionCancelledEmail } from "@/lib/email";

type Subscription = DodoPayments.Subscription;
type Tx = Prisma.TransactionClient;

// event.data.metadata.userId (set when we create the checkout session) is the primary way
// to identify the user — it's exact. Falling back to a Dodo customer-email lookup covers
// subscriptions Dodo created outside our checkout flow (e.g. dashboard-created test subs).
async function resolveUserId(
  tx: Tx,
  customerEmail: string,
  metadata: Record<string, string | number | boolean>
): Promise<string | null> {
  const userIdFromMetadata = typeof metadata.userId === "string" ? metadata.userId : null;
  if (userIdFromMetadata) {
    const match = await tx.user.findUnique({ where: { id: userIdFromMetadata }, select: { id: true } });
    if (match) return match.id;
  }

  const byEmail = await tx.user.findUnique({ where: { email: customerEmail }, select: { id: true } });
  return byEmail?.id ?? null;
}

// The user already linked to this subscription comes first: it's the only match that
// survives a subscription with no metadata.userId whose Dodo customer email differs from
// the account email. resolveUserId covers the first event, before anything is linked.
async function resolveSubscriptionUserId(tx: Tx, sub: Subscription): Promise<string | null> {
  const linked = await tx.user.findFirst({
    where: { dodoSubscriptionId: sub.subscription_id },
    select: { id: true },
  });
  return linked?.id ?? (await resolveUserId(tx, sub.customer.email, sub.metadata));
}

function planFromSubscription(sub: Subscription): PaidPlan | null {
  return planFromProductId(sub.product_id);
}

type UserContact = { userEmail: string; userName: string };

async function lookupUserContact(tx: Tx, sub: Subscription): Promise<UserContact | null> {
  const linked = await tx.user.findFirst({
    where: { dodoSubscriptionId: sub.subscription_id },
    select: { email: true, name: true },
  });
  if (linked) return { userEmail: linked.email, userName: linked.name ?? "" };

  const userId = await resolveUserId(tx, sub.customer.email, sub.metadata);
  if (!userId) return null;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  return user ? { userEmail: user.email, userName: user.name ?? "" } : null;
}

async function handleSubscriptionUpsert(tx: Tx, sub: Subscription): Promise<(UserContact & { plan: PaidPlan }) | null> {
  const plan = planFromSubscription(sub);
  const userId = await resolveSubscriptionUserId(tx, sub);

  // Still acknowledged and claimed: a retry would resolve no better than this did.
  if (!userId || !plan) {
    console.error("[dodo/webhook] could not resolve user/plan for subscription", sub.subscription_id, { userId, plan });
    return null;
  }

  const user = await tx.user.update({
    where: { id: userId },
    data: {
      plan,
      dodoCustomerId: sub.customer.customer_id,
      dodoSubscriptionId: sub.subscription_id,
      planExpiresAt: sub.next_billing_date ? new Date(sub.next_billing_date) : null,
    },
    select: { email: true, name: true },
  });

  return { userEmail: user.email, userName: user.name ?? "", plan };
}

async function handleSubscriptionDowngrade(tx: Tx, sub: Subscription): Promise<UserContact | null> {
  const userId = await resolveSubscriptionUserId(tx, sub);

  if (!userId) {
    console.error("[dodo/webhook] could not resolve user for downgraded subscription", sub.subscription_id);
    return null;
  }

  const user = await tx.user.update({
    where: { id: userId },
    data: { plan: "free", dodoSubscriptionId: null, planExpiresAt: null },
    select: { email: true, name: true },
  });

  return { userEmail: user.email, userName: user.name ?? "" };
}

// The webhook handler's only side effect used to be the User row upsert, which is safely
// re-appliable on a Dodo retry. Confirmation emails are not — sending one per handler call
// would duplicate mail on every retry, so the webhook-id must be claimed (unique constraint,
// same transaction as the plan write) before any email is queued. See CLAUDE.md's Dodo
// billing section.
type EmailTask =
  | { kind: "none" }
  | { kind: "welcome"; userEmail: string; userName: string; plan: PaidPlan }
  | { kind: "plan_changed"; userEmail: string; userName: string; plan: PaidPlan }
  | { kind: "cancelled"; userEmail: string; userName: string; accessUntil: Date };

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

  let emailTask: EmailTask;

  try {
    emailTask = await db.$transaction(async (tx): Promise<EmailTask> => {
      // Claim the delivery first. If this insert hits the unique constraint (skipped by
      // skipDuplicates), it's a Dodo retry of an event we already committed — do nothing,
      // including no email. Claim + plan write live in the same transaction so a failure
      // partway through rolls back the claim too, letting the retry reprocess cleanly.
      const claim = await tx.webhookEvent.createMany({
        data: [{ webhookId: headers["webhook-id"], eventType: event.type }],
        skipDuplicates: true,
      });
      if (claim.count === 0) return { kind: "none" };

      switch (event.type) {
        case "subscription.active": {
          const result = await handleSubscriptionUpsert(tx, event.data);
          return result ? { kind: "welcome", ...result } : { kind: "none" };
        }

        case "subscription.renewed":
        case "subscription.updated":
          await handleSubscriptionUpsert(tx, event.data);
          return { kind: "none" };

        case "subscription.plan_changed": {
          const result = await handleSubscriptionUpsert(tx, event.data);
          return result ? { kind: "plan_changed", ...result } : { kind: "none" };
        }

        case "subscription.cancelled": {
          const sub = event.data;
          if (sub.cancel_at_next_billing_date) {
            // Scheduled cancellation — plan stays active until subscription.expired fires.
            // Still confirm the cancellation now, with the grace-period end date.
            const contact = await lookupUserContact(tx, sub);
            return contact && sub.next_billing_date
              ? { kind: "cancelled", ...contact, accessUntil: new Date(sub.next_billing_date) }
              : { kind: "none" };
          }
          // Immediate cancellation — already downgraded, access ends now.
          const result = await handleSubscriptionDowngrade(tx, sub);
          return result ? { kind: "cancelled", ...result, accessUntil: new Date() } : { kind: "none" };
        }

        case "subscription.expired":
          await handleSubscriptionDowngrade(tx, event.data);
          return { kind: "none" };

        case "refund.succeeded": {
          // Deliberately no plan change. A refund doesn't cancel the Dodo subscription, so it
          // keeps billing and the next subscription.renewed would restore the plan anyway.
          // Whether to revoke access (and cancel the subscription) is a manual decision.
          const refund = event.data;
          console.warn(
            "[dodo/webhook] refund.succeeded — NO plan change made, manual review needed",
            { refundId: refund.refund_id, paymentId: refund.payment_id, customerId: refund.customer.customer_id, amount: refund.amount }
          );
          return { kind: "none" };
        }

        case "payment.failed": {
          // No plan change here either way. A failed subscription payment is a renewal or
          // a plan-change charge: with on_payment_failure: prevent_change Dodo keeps the
          // old plan and sends no subscription.plan_changed, so this log is the only
          // server-side trace that a customer's upgrade didn't happen.
          const payment = event.data;
          const details = {
            paymentId: payment.payment_id,
            subscriptionId: payment.subscription_id,
            customerId: payment.customer.customer_id,
            amount: payment.total_amount,
            currency: payment.currency,
            errorCode: payment.error_code,
            errorMessage: payment.error_message,
          };
          if (payment.subscription_id) {
            console.error("[dodo/webhook] payment.failed on a SUBSCRIPTION — renewal or plan change not charged", details);
          } else {
            console.warn("[dodo/webhook] payment.failed", details);
          }
          return { kind: "none" };
        }

        case "subscription.on_hold": {
          // Deliberately no plan change: on_hold is recoverable (the customer updates
          // their payment method) and subscription.expired / cancelled do the downgrade.
          // But it means this customer's billing is broken, so it must not pass silently.
          const sub = event.data;
          console.error("[dodo/webhook] subscription.on_hold — a charge failed, NO plan change made", {
            subscriptionId: sub.subscription_id,
            customerId: sub.customer.customer_id,
            productId: sub.product_id,
            nextBillingDate: sub.next_billing_date,
          });
          return { kind: "none" };
        }

        default:
          // Acknowledged (200) but not acted on — log so gaps like this stay visible.
          console.warn("[dodo/webhook] received event with no handler", {
            type: event.type,
            webhookId: headers["webhook-id"],
          });
          return { kind: "none" };
      }
    });
  } catch (err) {
    console.error("[dodo/webhook] handler error for event", event.type, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (emailTask.kind !== "none") {
    try {
      switch (emailTask.kind) {
        case "welcome":
          await sendSubscriptionWelcomeEmail(emailTask);
          break;
        case "plan_changed":
          await sendPlanChangedEmail(emailTask);
          break;
        case "cancelled":
          await sendSubscriptionCancelledEmail(emailTask);
          break;
      }
    } catch (err) {
      // The webhook-id claim is already committed at this point, so a failed send here
      // will not be retried by Dodo — the plan/DB state is correct regardless, so we log
      // and still acknowledge rather than fail the whole webhook.
      console.error("[dodo/webhook] failed to send confirmation email", emailTask.kind, err);
    }
  }

  return NextResponse.json({ received: true });
}
