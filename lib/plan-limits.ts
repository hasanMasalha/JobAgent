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
    browseJobsPerDay: 0, // Browse All Jobs — not available on Free
  },
  pro: {
    jobMatchesPerDay: 100, // matches per day
    autoAppliesPerMonth: 100, // auto-apply per month
    cvTailoringPerMonth: 100, // CV tailoring per month
    savedJobsMax: 500, // saved jobs
    cvVersionsMax: 3, // CV versions
    browseJobsPerDay: 100, // Browse All Jobs — same cap as matches
  },
  unlimited: {
    jobMatchesPerDay: 999999, // unlimited
    autoAppliesPerMonth: 999999, // unlimited
    cvTailoringPerMonth: 999999, // unlimited
    savedJobsMax: 999999, // unlimited
    cvVersionsMax: 10, // multiple CVs
    browseJobsPerDay: 999999, // unlimited
  },
} as const satisfies Record<PlanKey, Record<string, number>>;

export function normalizePlan(plan: string | null | undefined): PlanKey {
  return plan === "pro" || plan === "unlimited" ? plan : "free";
}

export function productIdFor(plan: PaidPlan, interval: BillingInterval): string | undefined {
  const map: Record<string, string | undefined> = {
    "pro:monthly": process.env.DODO_PRO_MONTHLY_PRODUCT_ID,
    "pro:annual": process.env.DODO_PRO_ANNUAL_PRODUCT_ID,
    "unlimited:monthly": process.env.DODO_UNLIMITED_MONTHLY_PRODUCT_ID,
    "unlimited:annual": process.env.DODO_UNLIMITED_ANNUAL_PRODUCT_ID,
  };
  return map[`${plan}:${interval}`];
}

// Reverse lookup used by the webhook to figure out which plan a Dodo product ID represents.
export function planFromProductId(productId: string | null | undefined): PaidPlan | null {
  if (!productId) return null;
  if (productId === process.env.DODO_PRO_MONTHLY_PRODUCT_ID || productId === process.env.DODO_PRO_ANNUAL_PRODUCT_ID) {
    return "pro";
  }
  if (
    productId === process.env.DODO_UNLIMITED_MONTHLY_PRODUCT_ID ||
    productId === process.env.DODO_UNLIMITED_ANNUAL_PRODUCT_ID
  ) {
    return "unlimited";
  }
  return null;
}

const PLAN_RANK: Record<PlanKey, number> = { free: 0, pro: 1, unlimited: 2 };

export function planRank(plan: PlanKey): number {
  return PLAN_RANK[plan];
}

// Reverse lookup of the billing interval for a Dodo product ID, or null if it isn't one of ours.
export function intervalFromProductId(productId: string | null | undefined): BillingInterval | null {
  if (!productId) return null;
  if (productId === process.env.DODO_PRO_MONTHLY_PRODUCT_ID || productId === process.env.DODO_UNLIMITED_MONTHLY_PRODUCT_ID) {
    return "monthly";
  }
  if (productId === process.env.DODO_PRO_ANNUAL_PRODUCT_ID || productId === process.env.DODO_UNLIMITED_ANNUAL_PRODUCT_ID) {
    return "annual";
  }
  return null;
}
