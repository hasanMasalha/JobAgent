import { NextRequest } from "next/server";

// The remaining auto-apply submit path: the jobId branch of
// mark-pending-extension.

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "u1@example.com" } } }) },
  }),
}));

jest.mock("@/lib/db", () => {
  const db: Record<string, unknown> = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    job: { findMany: jest.fn() },
    application: { create: jest.fn() },
  };
  // Transactions run on the same mock (lib/extension-handover.ts withJobLock).
  db.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(db));
  return { db };
});

jest.mock("@/lib/usage", () => ({
  ...jest.requireActual("@/lib/usage"),
  checkAndIncrementAutoApply: jest.fn(),
}));

import { db } from "@/lib/db";
import * as usage from "@/lib/usage";
import { POST as markPendingExtension } from "@/app/api/apply/mark-pending-extension/route";

const mdb = db as unknown as {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  user: { findUnique: jest.Mock };
  job: { findMany: jest.Mock };
  application: { create: jest.Mock };
};
const charge = usage.checkAndIncrementAutoApply as jest.Mock;
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) });
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");
// Writes to Application (the job lock is an $executeRaw too).
const updates = () => mdb.$executeRaw.mock.calls.filter((c) => sqlOf(c).includes("UPDATE"));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  mdb.user.findUnique.mockResolvedValue({
    plan: "free", name: "Test User", email: "u1@example.com", email_notifications: false,
    linkedin_automation_consent_at: new Date("2026-10-05T10:00:00Z"),
  });
  charge.mockResolvedValue({ allowed: true, remaining: 3 });
  mdb.application.create.mockResolvedValue({ id: "app-1", applied_at: new Date() });
});

describe("POST /api/apply/mark-pending-extension", () => {
  it.each([[{ jobId: "j1" }], [{ application_id: "app-1" }]])(
    "refuses %p without the LinkedIn automation consent, charging and marking nothing",
    async (body) => {
      mdb.user.findUnique.mockResolvedValue({ plan: "free", linkedin_automation_consent_at: null });
      const res = await markPendingExtension(post("/api/apply/mark-pending-extension", body));

      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("linkedin_consent_required");
      expect(charge).not.toHaveBeenCalled();
      expect(mdb.$executeRaw).not.toHaveBeenCalled();
      expect(mdb.$queryRaw).not.toHaveBeenCalled();
    },
  );

  // The blocking check (lib/extension-handover.ts) → `blocking`; the
  // application's job → j1; SELECT existing → `existing`; INSERT → new id;
  // CV skills → [].
  const route = (existing: unknown[], blocking: unknown[] = []) =>
    mdb.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("make_interval")) return Promise.resolve(blocking);
      if (sql.includes("SELECT job_id")) return Promise.resolve(existing.length ? [{ job_id: "j1" }] : []);
      if (sql.includes("SELECT id, auto_apply_charged")) return Promise.resolve(existing);
      if (sql.includes('INSERT INTO "Application"')) return Promise.resolve([{ id: "app-new" }]);
      return Promise.resolve([]);
    });

  it("jobId flow charges one credit and marks the new application as holding it", async () => {
    route([]);
    const res = await markPendingExtension(post("/api/apply/mark-pending-extension", { jobId: "j1" }));

    expect(res.status).toBe(200);
    expect(charge).toHaveBeenCalledTimes(1);
    const insert = mdb.$queryRaw.mock.calls.find((c) => sqlOf(c).includes("INSERT"))!;
    expect(sqlOf(insert)).toContain("auto_apply_charged");
  });

  it("jobId flow returns the limit 403 and queues nothing when no credit is left", async () => {
    route([]);
    charge.mockResolvedValue({ allowed: false, remaining: 0 });

    const res = await markPendingExtension(post("/api/apply/mark-pending-extension", { jobId: "j1" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("limit_reached");
    expect(mdb.$queryRaw.mock.calls.some((c) => sqlOf(c).includes("INSERT"))).toBe(false);
    expect(updates()).toEqual([]);
  });

  it("jobId flow doesn't charge again for an application already holding a credit", async () => {
    route([{ id: "app-x", auto_apply_charged: true }]);
    await markPendingExtension(post("/api/apply/mark-pending-extension", { jobId: "j1" }));
    expect(charge).not.toHaveBeenCalled();
  });

  // The apply page's LinkedIn confirm. It used to be free here (the page
  // charged a CV tailoring instead); LinkedIn jobs are no longer tailored, so
  // it spends an auto-apply like every other submit path.
  it("application_id flow charges one credit and marks the application as holding it", async () => {
    route([{ id: "app-t", auto_apply_charged: false }]);
    const res = await markPendingExtension(post("/api/apply/mark-pending-extension", { application_id: "app-t" }));
    expect(res.status).toBe(200);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(sqlOf(updates()[0])).toContain("auto_apply_charged = true");
  });

  it("application_id flow returns the limit 403 and marks nothing when no credit is left", async () => {
    route([{ id: "app-t", auto_apply_charged: false }]);
    charge.mockResolvedValue({ allowed: false, remaining: 0 });
    const res = await markPendingExtension(post("/api/apply/mark-pending-extension", { application_id: "app-t" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("limit_reached");
    expect(updates()).toEqual([]);
  });

  it("application_id flow doesn't charge again for an application already holding a credit", async () => {
    route([{ id: "app-t", auto_apply_charged: true }]);
    const res = await markPendingExtension(post("/api/apply/mark-pending-extension", { application_id: "app-t" }));
    expect(res.status).toBe(200);
    expect(charge).not.toHaveBeenCalled();
  });

  it("application_id flow charges nothing for an application that isn't the caller's", async () => {
    route([]);
    const res = await markPendingExtension(post("/api/apply/mark-pending-extension", { application_id: "someone-elses" }));
    expect(res.status).toBe(404);
    expect(charge).not.toHaveBeenCalled();
    expect(mdb.$executeRaw).not.toHaveBeenCalled();
  });

  // One hand-over per job: a reopened apply page has a new draft, and
  // confirming it used to charge and queue the job a second time.
  it.each([
    ["pending_extension", "in_progress"],
    ["applied", "already_applied"],
  ])("hands nothing over while the job is %s, and charges nothing", async (status, error) => {
    for (const body of [{ jobId: "j1" }, { application_id: "app-t" }]) {
      jest.clearAllMocks();
      route([{ id: "app-t", auto_apply_charged: false }], [{ id: "app-first", status }]);
      const res = await markPendingExtension(post("/api/apply/mark-pending-extension", body));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(error);
      expect(charge).not.toHaveBeenCalled();
      expect(updates()).toEqual([]);
      expect(mdb.$queryRaw.mock.calls.some((c) => sqlOf(c).includes("INSERT"))).toBe(false);
    }
  });

  it("decides under a lock per user and job, and records when it was handed over", async () => {
    route([{ id: "app-t", auto_apply_charged: false }]);
    await markPendingExtension(post("/api/apply/mark-pending-extension", { application_id: "app-t" }));
    const lock = mdb.$executeRaw.mock.calls.find((c) => sqlOf(c).includes("pg_advisory_xact_lock"))!;
    expect(lock.slice(1)).toEqual(["u1", "j1"]);
    expect(sqlOf(updates()[0])).toContain("applied_at = NOW()");
  });
});
