import type { BillingInterval, PaidPlan } from "@/lib/plan-limits";

// Client side of an in-place plan change (/api/dodo/checkout returning
// `changed`). An accepted changePlan request is not a changed plan: the
// prorated charge can still fail, and Dodo then keeps the old plan. So the
// pricing page and the onboarding plan picker wait on
// /api/dodo/plan-change-status before saying anything about the outcome.

export type PlanChangeOutcome =
  | { status: "applied" }
  | { status: "failed"; reason: string | null }
  | { status: "pending" };

export interface PlanChangeTarget {
  plan: PaidPlan;
  interval: BillingInterval;
  paymentId?: string | null;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 45000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls until Dodo reports the change applied or failed. Resolves "pending"
 * if neither happens within the timeout — never "applied" on a guess. A
 * request that errors counts as no answer yet.
 */
export async function waitForPlanChange(
  target: PlanChangeTarget,
  { intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS } = {},
): Promise<PlanChangeOutcome> {
  const params = new URLSearchParams({ plan: target.plan, interval: target.interval });
  if (target.paymentId) params.set("paymentId", target.paymentId);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`/api/dodo/plan-change-status?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "applied") return { status: "applied" };
        if (data.status === "failed") {
          return { status: "failed", reason: typeof data.reason === "string" && data.reason ? data.reason : null };
        }
      }
    } catch {
      // Network blip — try again until the deadline.
    }
    if (Date.now() + intervalMs > deadline) return { status: "pending" };
    await sleep(intervalMs);
  }
}

export function planChangeFailedMessage(reason: string | null): string {
  return `${reason ?? "Your payment didn't go through."} Your plan hasn't changed. Check your payment method and try again.`;
}

export const PLAN_CHANGE_UNCONFIRMED_MESSAGE =
  "Your plan change isn't confirmed yet, so your plan hasn't changed so far. We'll email you if it goes through. If it doesn't, check your payment method and try again.";

export const PLAN_CHANGE_SCHEDULED_MESSAGE = "Your plan will change at the start of your next billing period.";
