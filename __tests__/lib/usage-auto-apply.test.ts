jest.mock("@/lib/db", () => ({
  db: {
    userUsage: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  },
}));

import { db } from "@/lib/db";
import { checkAndIncrementAutoApply, refundAutoApply, refundAutoApplyForApplication } from "@/lib/usage";
import { PLAN_LIMITS } from "@/lib/plan-limits";

const usage = db.userUsage as unknown as Record<string, jest.Mock>;
const queryRaw = db.$queryRaw as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // Same UTC month, so resetMonthlyCounters is a no-op.
  usage.findUnique.mockResolvedValue({ userId: "u1", autoAppliesThisMonth: 2, appliancesResetAt: new Date() });
});

describe("checkAndIncrementAutoApply", () => {
  it("charges with one conditional update bounded by the plan limit", async () => {
    usage.updateMany.mockResolvedValue({ count: 1 });
    usage.findUnique.mockResolvedValueOnce({ userId: "u1", autoAppliesThisMonth: 2, appliancesResetAt: new Date() })
      .mockResolvedValueOnce({ userId: "u1", autoAppliesThisMonth: 3 });

    const res = await checkAndIncrementAutoApply("u1", "free");

    expect(res).toEqual({ allowed: true, remaining: PLAN_LIMITS.free.autoAppliesPerMonth - 3 });
    expect(usage.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", autoAppliesThisMonth: { lt: PLAN_LIMITS.free.autoAppliesPerMonth } },
      data: { autoAppliesThisMonth: { increment: 1 }, totalAutoApplies: { increment: 1 } },
    });
  });

  it("refuses without incrementing when no credit is left", async () => {
    usage.updateMany.mockResolvedValue({ count: 0 });
    expect(await checkAndIncrementAutoApply("u1", "free")).toEqual({ allowed: false, remaining: 0 });
    expect(usage.update).not.toHaveBeenCalled();
  });
});

describe("refunds", () => {
  it("refundAutoApply never takes the counter below zero", async () => {
    usage.updateMany.mockResolvedValue({ count: 1 });
    await refundAutoApply("u1");
    expect(usage.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", autoAppliesThisMonth: { gt: 0 } },
      data: { autoAppliesThisMonth: { decrement: 1 }, totalAutoApplies: { decrement: 1 } },
    });
  });

  it("refunds an application's credit when it holds one", async () => {
    queryRaw.mockResolvedValue([{ id: "app-1" }]);
    usage.updateMany.mockResolvedValue({ count: 1 });
    expect(await refundAutoApplyForApplication("app-1", "u1")).toBe(true);
    expect(usage.updateMany).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an uncharged or already-refunded application", async () => {
    queryRaw.mockResolvedValue([]);
    expect(await refundAutoApplyForApplication("app-1", "u1")).toBe(false);
    expect(usage.updateMany).not.toHaveBeenCalled();
  });
});
