import { NextRequest } from "next/server";

// The remaining auto-apply submit paths: the jobId branch of
// mark-pending-extension, and batch email auto-apply.

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "u1@example.com" } } }) },
  }),
}));

jest.mock("@/lib/db", () => ({
  db: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    job: { findMany: jest.fn() },
    application: { create: jest.fn() },
  },
}));

jest.mock("@/lib/usage", () => ({
  ...jest.requireActual("@/lib/usage"),
  checkAndIncrementAutoApply: jest.fn(),
}));

const sendEmail = jest.fn();
jest.mock("resend", () => ({ Resend: jest.fn(() => ({ emails: { send: sendEmail } })) }));
jest.mock("@/lib/email", () => ({ sendApplicationConfirmationEmail: jest.fn() }));

import { db } from "@/lib/db";
import * as usage from "@/lib/usage";
import { POST as markPendingExtension } from "@/app/api/apply/mark-pending-extension/route";
import { POST as batchAuto } from "@/app/api/apply/batch-auto/route";

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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  mdb.user.findUnique.mockResolvedValue({
    plan: "free", name: "Test User", email: "u1@example.com", email_notifications: false,
    linkedin_automation_consent_at: new Date("2026-10-05T10:00:00Z"),
  });
  charge.mockResolvedValue({ allowed: true, remaining: 3 });
  sendEmail.mockResolvedValue({ id: "email-1" });
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

  // SELECT existing → `existing`; INSERT → new id; CV skills → [].
  const route = (existing: unknown[]) =>
    mdb.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join("?");
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
    expect(mdb.$executeRaw).not.toHaveBeenCalled();
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
    expect(sqlOf(mdb.$executeRaw.mock.calls[0])).toContain("auto_apply_charged = true");
  });

  it("application_id flow returns the limit 403 and marks nothing when no credit is left", async () => {
    route([{ id: "app-t", auto_apply_charged: false }]);
    charge.mockResolvedValue({ allowed: false, remaining: 0 });
    const res = await markPendingExtension(post("/api/apply/mark-pending-extension", { application_id: "app-t" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("limit_reached");
    expect(mdb.$executeRaw).not.toHaveBeenCalled();
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
});

describe("POST /api/apply/batch-auto", () => {
  beforeEach(() => {
    mdb.$queryRaw.mockResolvedValue([{ clean_summary: "Summary" }]);
    mdb.job.findMany.mockResolvedValue([
      { id: "j1", title: "A", company: "Acme", url: "u1", recruiter_email: "hr@acme.example" },
      { id: "j2", title: "B", company: "Beta", url: "u2", recruiter_email: null },
      { id: "j3", title: "C", company: "Gamma", url: "u3", recruiter_email: "jobs@gamma.example" },
    ]);
  });

  it("charges one credit per email sent and none for jobs it skips", async () => {
    const data = await (await batchAuto(post("/api/apply/batch-auto", { jobIds: ["j1", "j2", "j3"] }))).json();

    expect(charge).toHaveBeenCalledTimes(2); // j2 has no recruiter email
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(data.count).toBe(2);
    expect(data.results).toContainEqual({ jobId: "j2", status: "skipped_no_email" });
  });

  it("stops sending once the limit runs out", async () => {
    charge.mockResolvedValueOnce({ allowed: true, remaining: 0 }).mockResolvedValueOnce({ allowed: false, remaining: 0 });

    const data = await (await batchAuto(post("/api/apply/batch-auto", { jobIds: ["j1", "j2", "j3"] }))).json();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(data.results).toContainEqual({ jobId: "j3", status: "limit_reached" });
  });

  it("returns the limit 403 and sends nothing when no credit is left", async () => {
    charge.mockResolvedValue({ allowed: false, remaining: 0 });

    const res = await batchAuto(post("/api/apply/batch-auto", { jobIds: ["j1", "j3"] }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("limit_reached");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
