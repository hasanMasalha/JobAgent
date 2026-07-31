export type PaidPlan = "pro" | "unlimited";
export type BillingInterval = "monthly" | "annual";
export type PlanKey = "free" | "pro" | "unlimited";

export const PLAN_LIMITS = {
  free: {
    jobMatchesPerDay: 10, // AI matches shown per day
    autoAppliesPerMonth: 5, // auto-apply submissions
    cvTailoringPerMonth: 5, // CV tailoring requests
    savedJobsMax: 20, // saved/bookmarked jobs
    cvVersionsMax: 1, // number of CV versions
  },
  pro: {
    jobMatchesPerDay: 100, // matches per day
    autoAppliesPerMonth: 100, // auto-apply per month
    cvTailoringPerMonth: 100, // CV tailoring per month
    savedJobsMax: 500, // saved jobs
    cvVersionsMax: 3, // CV versions
  },
  unlimited: {
    jobMatchesPerDay: 999999, // unlimited
    autoAppliesPerMonth: 999999, // unlimited
    cvTailoringPerMonth: 999999, // unlimited
    savedJobsMax: 999999, // unlimited
    cvVersionsMax: 10, // multiple CVs
  },
} as const satisfies Record<PlanKey, Record<string, number>>;

export function normalizePlan(plan: string | null | undefined): PlanKey {
  return plan === "pro" || plan === "unlimited" ? plan : "free";
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
