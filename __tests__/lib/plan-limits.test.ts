import { PLAN_LIMITS, planFeatureHighlights, planFeatureList } from "@/lib/plan-limits";

describe("planFeatureList", () => {
  it("states each plan's enforced limits", () => {
    expect(planFeatureList("free")).toEqual([
      `${PLAN_LIMITS.free.jobMatchesPerDay} AI job matches per day`,
      `${PLAN_LIMITS.free.autoAppliesPerMonth} auto-applies per month`,
      `${PLAN_LIMITS.free.cvTailoringPerMonth} CV tailoring requests per month`,
    ]);
    expect(planFeatureList("pro")).toContain(
      `Browse All Jobs, ${PLAN_LIMITS.pro.browseJobsPerDay} listings per day`,
    );
  });

  it("says Unlimited instead of printing the sentinel number", () => {
    const bullets = planFeatureList("unlimited");
    expect(bullets).toContain("Unlimited auto-applies");
    expect(bullets.join(" ")).not.toMatch(/999/);
  });

  it("leaves out Browse All Jobs when the plan doesn't include it", () => {
    expect(PLAN_LIMITS.free.browseJobsPerDay).toBe(0);
    expect(planFeatureList("free").join(" ")).not.toMatch(/Browse/);
  });

  // savedJobsMax and cvVersionsMax aren't enforced by lib/usage.ts, so no
  // surface may advertise them.
  it("never advertises unenforced limits", () => {
    for (const plan of ["free", "pro", "unlimited"] as const) {
      expect(planFeatureList(plan).join(" ")).not.toMatch(/saved jobs|CV version/i);
    }
  });

  it("gives confirmation emails the same bullets as the pricing page", () => {
    expect(planFeatureHighlights("pro")).toEqual(planFeatureList("pro"));
  });
});
