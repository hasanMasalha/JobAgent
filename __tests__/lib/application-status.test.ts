import { APPLICATION_STATUS, statusMeta } from "@/lib/application-status";

describe("statusMeta", () => {
  it("covers every status the tracker styles today", () => {
    for (const s of [
      "applying", "applied", "interviewing", "offer", "rejected", "draft", "manual",
      "cancelled", "failed", "pending_verification", "needs_manual", "needs_security_code",
    ]) {
      expect(APPLICATION_STATUS[s]).toBeDefined();
    }
  });

  it("presents legacy failed / needs_security_code exactly like needs_manual", () => {
    expect(statusMeta("failed")).toEqual(statusMeta("needs_manual"));
    expect(statusMeta("needs_security_code")).toEqual(statusMeta("needs_manual"));
  });

  it("flags statuses that need the user to act", () => {
    expect(statusMeta("pending_verification").needsAction).toBe(true);
    expect(statusMeta("needs_manual").needsAction).toBe(true);
    expect(statusMeta("applied").needsAction).toBe(false);
  });

  it("falls back to a readable neutral label for unknown statuses", () => {
    expect(statusMeta("on_hold")).toEqual({ label: "On hold", tone: "neutral", needsAction: false });
  });
});
