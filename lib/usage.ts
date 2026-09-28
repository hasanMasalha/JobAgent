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

// Takes one monthly auto-apply credit if one is left. Every path where
// JobAgent submits for the user charges here: quick apply (ATS), batch email
// auto-apply, and extension applies queued from the dashboard. Tailor & Apply
// doesn't — it's already capped by cvTailoringPerMonth at the same numbers.
//
// The check and the increment are one conditional UPDATE, so two concurrent
// requests can't both spend the last credit.
export async function checkAndIncrementAutoApply(
  userId: string,
  plan: PlanKey
): Promise<{ allowed: boolean; remaining: number }> {
  await resetMonthlyCounters(userId);
  const limit = PLAN_LIMITS[plan].autoAppliesPerMonth;

  const { count } = await db.userUsage.updateMany({
    where: { userId, autoAppliesThisMonth: { lt: limit } },
    data: {
      autoAppliesThisMonth: { increment: 1 },
      totalAutoApplies: { increment: 1 },
    },
  });
  if (count === 0) return { allowed: false, remaining: 0 };

  const updated = await db.userUsage.findUnique({ where: { userId } });
  return { allowed: true, remaining: Math.max(0, limit - (updated?.autoAppliesThisMonth ?? limit)) };
}

// Gives back one auto-apply credit. Never takes the counter below zero (a
// monthly reset can land between the charge and the refund).
export async function refundAutoApply(userId: string): Promise<void> {
  await db.userUsage.updateMany({
    where: { userId, autoAppliesThisMonth: { gt: 0 } },
    data: {
      autoAppliesThisMonth: { decrement: 1 },
      totalAutoApplies: { decrement: 1 },
    },
  });
}

// Refunds the credit an application holds, if it holds one. Clearing
// auto_apply_charged and refunding are tied together by the conditional
// UPDATE, so repeated failure reports refund at most once, and applications
// that were never charged (Tailor & Apply) are never refunded.
export async function refundAutoApplyForApplication(applicationId: string, userId: string): Promise<boolean> {
  const cleared = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Application" SET auto_apply_charged = false
    WHERE id = ${applicationId} AND user_id = ${userId} AND auto_apply_charged = true
    RETURNING id
  `;
  if (cleared.length === 0) return false;
  await refundAutoApply(userId);
  return true;
}

/** The 403 body every auto-apply route returns when the monthly limit is spent. */
export const AUTO_APPLY_LIMIT_RESPONSE = {
  error: "limit_reached",
  feature: "autoApply",
  message: "You've reached your monthly auto-apply limit.",
  upgrade_url: "/pricing",
} as const;

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
