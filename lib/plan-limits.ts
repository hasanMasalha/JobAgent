export type PaidPlan = "pro" | "unlimited";
export type BillingInterval = "monthly" | "annual";

// null = unlimited
export const MONTHLY_AUTO_APPLY_LIMITS: Record<string, number | null> = {
  free: 5,
  pro: 100,
  unlimited: null,
};

export function getMonthlyAutoApplyLimit(plan: string): number | null {
  return plan in MONTHLY_AUTO_APPLY_LIMITS
    ? MONTHLY_AUTO_APPLY_LIMITS[plan]
    : MONTHLY_AUTO_APPLY_LIMITS.free;
}

export function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// null = unlimited
export const DAILY_MATCH_LIMITS: Record<string, number | null> = {
  free: 10,
  pro: null,
  unlimited: null,
};

export function getDailyMatchLimit(plan: string): number | null {
  return plan in DAILY_MATCH_LIMITS ? DAILY_MATCH_LIMITS[plan] : DAILY_MATCH_LIMITS.free;
}

export function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function priceIdFor(plan: PaidPlan, interval: BillingInterval): string | undefined {
  const map: Record<string, string | undefined> = {
    "pro:monthly": process.env.PADDLE_PRO_MONTHLY_PRICE_ID,
    "pro:annual": process.env.PADDLE_PRO_ANNUAL_PRICE_ID,
    "unlimited:monthly": process.env.PADDLE_UNLIMITED_MONTHLY_PRICE_ID,
    "unlimited:annual": process.env.PADDLE_UNLIMITED_ANNUAL_PRICE_ID,
  };
  return map[`${plan}:${interval}`];
}

// Reverse lookup used by the webhook to figure out which plan a Paddle price ID represents.
export function planFromPriceId(priceId: string | null | undefined): PaidPlan | null {
  if (!priceId) return null;
  if (priceId === process.env.PADDLE_PRO_MONTHLY_PRICE_ID || priceId === process.env.PADDLE_PRO_ANNUAL_PRICE_ID) {
    return "pro";
  }
  if (priceId === process.env.PADDLE_UNLIMITED_MONTHLY_PRICE_ID || priceId === process.env.PADDLE_UNLIMITED_ANNUAL_PRICE_ID) {
    return "unlimited";
  }
  return null;
}
