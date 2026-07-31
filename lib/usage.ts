import { db } from "@/lib/db";
import { PLAN_LIMITS, type PlanKey } from "@/lib/plan-limits";
import type { UserUsage } from "@prisma/client";

function isSameUTCDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function isSameUTCMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

export async function getOrCreateUsage(userId: string): Promise<UserUsage> {
  const existing = await db.userUsage.findUnique({ where: { userId } });
  if (existing) return existing;

  try {
    return await db.userUsage.create({ data: { userId } });
  } catch {
    // Race: another request created the row first.
    const row = await db.userUsage.findUnique({ where: { userId } });
    if (row) return row;
    throw new Error(`Failed to get or create usage row for user ${userId}`);
  }
}

export async function resetDailyCounters(userId: string): Promise<UserUsage> {
  const usage = await getOrCreateUsage(userId);
  const now = new Date();
  if (isSameUTCDate(usage.matchesResetAt, now)) return usage;

  return db.userUsage.update({
    where: { userId },
    data: { jobMatchesToday: 0, browseJobsToday: 0, matchesResetAt: now },
  });
}

export async function resetMonthlyCounters(userId: string): Promise<UserUsage> {
  const usage = await getOrCreateUsage(userId);
  const now = new Date();
  if (isSameUTCMonth(usage.appliancesResetAt, now)) return usage;

  return db.userUsage.update({
    where: { userId },
    data: { autoAppliesThisMonth: 0, cvTailoringThisMonth: 0, appliancesResetAt: now },
  });
}

// Checks the daily match quota and, if allowed, increments jobMatchesToday by
// however many of `requestedCount` fit in the remaining quota. Pass
// requestedCount: 0 to peek at remaining quota without consuming any of it
// (used to skip the upstream matching call entirely once quota is exhausted).
export async function checkAndIncrementMatches(
  userId: string,
  plan: PlanKey,
  requestedCount = 1
): Promise<{ allowed: boolean; remaining: number; granted: number }> {
  const usage = await resetDailyCounters(userId);
  const limit = PLAN_LIMITS[plan].jobMatchesPerDay;
  const remainingBefore = Math.max(0, limit - usage.jobMatchesToday);

  if (remainingBefore <= 0) {
    return { allowed: false, remaining: 0, granted: 0 };
  }
  if (requestedCount <= 0) {
    return { allowed: true, remaining: remainingBefore, granted: 0 };
  }

  const granted = Math.min(requestedCount, remainingBefore);
  const updated = await db.userUsage.update({
    where: { userId },
    data: {
      jobMatchesToday: { increment: granted },
      totalJobsViewed: { increment: granted },
    },
  });

  return { allowed: true, remaining: Math.max(0, limit - updated.jobMatchesToday), granted };
}

// Same shape as checkAndIncrementMatches — Browse All Jobs shares the daily
// reset marker (matchesResetAt) but has its own counter (browseJobsToday).
// Free plan has a limit of 0, so it's naturally blocked without a special case.
export async function checkAndIncrementBrowseJobs(
  userId: string,
  plan: PlanKey,
  requestedCount = 1
): Promise<{ allowed: boolean; remaining: number; granted: number }> {
  const usage = await resetDailyCounters(userId);
  const limit = PLAN_LIMITS[plan].browseJobsPerDay;
  const remainingBefore = Math.max(0, limit - usage.browseJobsToday);

  if (remainingBefore <= 0) {
    return { allowed: false, remaining: 0, granted: 0 };
  }
  if (requestedCount <= 0) {
    return { allowed: true, remaining: remainingBefore, granted: 0 };
  }

  const granted = Math.min(requestedCount, remainingBefore);
  const updated = await db.userUsage.update({
    where: { userId },
    data: { browseJobsToday: { increment: granted } },
  });

  return { allowed: true, remaining: Math.max(0, limit - updated.browseJobsToday), granted };
}

export async function checkAndIncrementAutoApply(
  userId: string,
  plan: PlanKey
): Promise<{ allowed: boolean; remaining: number }> {
  const usage = await resetMonthlyCounters(userId);
  const limit = PLAN_LIMITS[plan].autoAppliesPerMonth;

  if (usage.autoAppliesThisMonth >= limit) {
    return { allowed: false, remaining: 0 };
  }

  const updated = await db.userUsage.update({
    where: { userId },
    data: {
      autoAppliesThisMonth: { increment: 1 },
      totalAutoApplies: { increment: 1 },
    },
  });

  return { allowed: true, remaining: Math.max(0, limit - updated.autoAppliesThisMonth) };
}

export async function checkAndIncrementCvTailoring(
  userId: string,
  plan: PlanKey
): Promise<{ allowed: boolean; remaining: number }> {
  const usage = await resetMonthlyCounters(userId);
  const limit = PLAN_LIMITS[plan].cvTailoringPerMonth;

  if (usage.cvTailoringThisMonth >= limit) {
    return { allowed: false, remaining: 0 };
  }

  const updated = await db.userUsage.update({
    where: { userId },
    data: {
      cvTailoringThisMonth: { increment: 1 },
      totalCvTailoring: { increment: 1 },
    },
  });

  return { allowed: true, remaining: Math.max(0, limit - updated.cvTailoringThisMonth) };
}

export interface UsageSummary {
  plan: PlanKey;
  usage: {
    jobMatches: { today: number; limit: number; remaining: number };
    autoApplies: { thisMonth: number; limit: number; remaining: number };
    cvTailoring: { thisMonth: number; limit: number; remaining: number };
  };
  resetDates: {
    daily: string;
    monthly: string;
  };
}

export async function getUserUsageSummary(userId: string, plan: PlanKey): Promise<UsageSummary> {
  await resetDailyCounters(userId);
  const usage = await resetMonthlyCounters(userId);
  const limits = PLAN_LIMITS[plan];

  const dailyReset = new Date(
    Date.UTC(
      usage.matchesResetAt.getUTCFullYear(),
      usage.matchesResetAt.getUTCMonth(),
      usage.matchesResetAt.getUTCDate() + 1
    )
  );
  const monthlyReset = new Date(
    Date.UTC(usage.appliancesResetAt.getUTCFullYear(), usage.appliancesResetAt.getUTCMonth() + 1, 1)
  );

  return {
    plan,
    usage: {
      jobMatches: {
        today: usage.jobMatchesToday,
        limit: limits.jobMatchesPerDay,
        remaining: Math.max(0, limits.jobMatchesPerDay - usage.jobMatchesToday),
      },
      autoApplies: {
        thisMonth: usage.autoAppliesThisMonth,
        limit: limits.autoAppliesPerMonth,
        remaining: Math.max(0, limits.autoAppliesPerMonth - usage.autoAppliesThisMonth),
      },
      cvTailoring: {
        thisMonth: usage.cvTailoringThisMonth,
        limit: limits.cvTailoringPerMonth,
        remaining: Math.max(0, limits.cvTailoringPerMonth - usage.cvTailoringThisMonth),
      },
    },
    resetDates: {
      daily: dailyReset.toISOString(),
      monthly: monthlyReset.toISOString(),
    },
  };
}
