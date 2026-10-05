import { NextRequest } from "next/server";

// The LinkedIn automation risk notice: consent is recorded only when the box
// was ticked, the first timestamp is kept, and the notice page only returns
// to a dashboard path.

const getUser = jest.fn();
jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));
jest.mock("@/lib/db", () => ({
  db: { $executeRaw: jest.fn(), user: { findUnique: jest.fn() } },
}));

import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/linkedin/automation-consent/route";
import { isSafeNext, linkedInSetupHref } from "@/lib/linkedin-consent";

const mdb = db as unknown as { $executeRaw: jest.Mock; user: { findUnique: jest.Mock } };
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/linkedin/automation-consent", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  mdb.user.findUnique.mockResolvedValue({ linkedin_automation_consent_at: null });
});

describe("/api/linkedin/automation-consent", () => {
  it("needs a session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET()).status).toBe(401);
    expect((await POST(post({ understood: true }))).status).toBe(401);
  });

  it("reports no consent for a user who hasn't given it", async () => {
    expect(await (await GET()).json()).toEqual({ consented: false, consentedAt: null });
  });

  it.each([[{}], [{ understood: false }], [{ understood: "yes" }]])("records nothing for %p", async (body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(mdb.$executeRaw).not.toHaveBeenCalled();
  });

  it("records it once, keeping the first timestamp", async () => {
    const at = new Date("2026-10-05T10:00:00Z");
    mdb.user.findUnique.mockResolvedValue({ linkedin_automation_consent_at: at });

    const res = await POST(post({ understood: true }));

    expect(await res.json()).toEqual({ consented: true, consentedAt: at.toISOString() });
    const sql = (mdb.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(sql).toContain("COALESCE(linkedin_automation_consent_at, now())");
  });
});

describe("the notice page's return path", () => {
  it.each([["/dashboard/apply/abc"], ["/dashboard/matches"]])("passes through %s", (next) => {
    expect(isSafeNext(next)).toBe(true);
    expect(linkedInSetupHref(next)).toBe(`/dashboard/linkedin-extension?next=${encodeURIComponent(next)}`);
  });

  it.each([["https://evil.example"], ["//evil.example"], ["/pricing"], ["/dashboard\\..\\x"], [""], [null]])(
    "drops %p",
    (next) => {
      expect(isSafeNext(next)).toBe(false);
    },
  );
});
