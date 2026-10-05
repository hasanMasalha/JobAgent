import { NextRequest } from "next/server";

// Every path where JobAgent submits for the user must spend a monthly
// auto-apply credit, and give it back when nothing was submitted.

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "u1@example.com" } } }) },
  }),
}));

jest.mock("@/lib/db", () => ({
  db: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    job: { findMany: jest.fn() },
    application: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  },
}));

jest.mock("@/lib/usage", () => ({
  ...jest.requireActual("@/lib/usage"),
  checkAndIncrementAutoApply: jest.fn(),
  refundAutoApply: jest.fn(),
  refundAutoApplyForApplication: jest.fn(),
}));

import { db } from "@/lib/db";
import * as usage from "@/lib/usage";
import { POST as quickApply } from "@/app/api/apply/quick/route";
import { POST as batchMarkPending } from "@/app/api/apply/batch-mark-pending/route";
import { POST as updateStatus } from "@/app/api/applications/update-status/route";
import { MAX_EXTENSION_BATCH } from "@/lib/extension-batch";

const mdb = db as unknown as {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  user: { findUnique: jest.Mock; findFirst: jest.Mock };
  job: { findMany: jest.Mock };
  application: { findFirst: jest.Mock; update: jest.Mock; create: jest.Mock };
};
const charge = usage.checkAndIncrementAutoApply as jest.Mock;
const refundForApp = usage.refundAutoApplyForApplication as jest.Mock;
const refund = usage.refundAutoApply as jest.Mock;

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) });

// $queryRaw is a tagged template: answer by what the SQL is doing.
function sqlRouter(job: Record<string, unknown>) {
  mdb.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes('FROM "Job"')) return Promise.resolve([job]);
    if (sql.includes('INSERT INTO "Application"')) return Promise.resolve([{ id: "app-1" }]);
    return Promise.resolve([]);
  });
}

const ATS_JOB = { url: "https://boards.greenhouse.io/acme/jobs/1", apply_url: null, title: "Engineer", company: "Acme", apply_type: "auto" };

beforeEach(() => {
  jest.clearAllMocks();
  mdb.user.findUnique.mockResolvedValue({ plan: "free", linkedin_automation_consent_at: new Date("2026-10-05T10:00:00Z") });
  mdb.user.findFirst.mockResolvedValue({ first_name: "A", last_name: "B", email: "u1@example.com", phone: null, linkedin_url: null });
  charge.mockResolvedValue({ allowed: true, remaining: 4 });
  global.fetch = jest.fn();
});

describe("POST /api/apply/quick", () => {
  const pythonReturns = (status: number, body: unknown) =>
    (global.fetch as jest.Mock).mockResolvedValue({ ok: status < 400, status, text: async () => JSON.stringify(body) });

  it("returns the limit 403 and creates nothing when no credit is left", async () => {
    sqlRouter(ATS_JOB);
    charge.mockResolvedValue({ allowed: false, remaining: 0 });

    const res = await quickApply(post("/api/apply/quick", { jobId: "j1" }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "limit_reached", feature: "autoApply" });
    const inserts = mdb.$queryRaw.mock.calls.filter(([s]) => s.join("?").includes("INSERT"));
    expect(inserts).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("charges once and keeps the credit when the ATS submission starts", async () => {
    sqlRouter(ATS_JOB);
    pythonReturns(200, { success: true, status: "applying" });

    const res = await quickApply(post("/api/apply/quick", { jobId: "j1" }));

    expect((await res.json()).status).toBe("applying");
    expect(charge).toHaveBeenCalledTimes(1);
    expect(refundForApp).not.toHaveBeenCalled();
  });

  it.each([
    ["the ATS service errors", () => pythonReturns(502, { detail: "down" })],
    ["the form has a CAPTCHA", () => pythonReturns(200, { success: false, captcha: true })],
    ["the ATS rejects the application", () => pythonReturns(200, { success: false, error: "missing field" })],
    ["the request throws", () => (global.fetch as jest.Mock).mockRejectedValue(new Error("timeout"))],
  ])("refunds the application's credit when %s", async (_label, arrange) => {
    sqlRouter(ATS_JOB);
    arrange();

    await quickApply(post("/api/apply/quick", { jobId: "j1" }));

    expect(refundForApp).toHaveBeenCalledWith("app-1", "u1");
  });

  it.each([
    ["external jobs", { ...ATS_JOB, apply_type: "external", url: "https://acme.example/careers" }],
    ["LinkedIn jobs routed to the extension", { ...ATS_JOB, url: "https://www.linkedin.com/jobs/view/1" }],
    ["jobs with no detectable ATS", { ...ATS_JOB, url: "https://acme.example/careers/1" }],
  ])("doesn't charge %s — JobAgent submits nothing", async (_label, job) => {
    sqlRouter(job);
    await quickApply(post("/api/apply/quick", { jobId: "j1" }));
    expect(charge).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });
});

describe("POST /api/apply/quick for a LinkedIn listing", () => {
  // Stored LinkedIn rows are "external" or "auto": nothing knows at scrape
  // time whether a listing is Easy Apply. They go to the extension flow by
  // URL, and must not be recorded as applied manually on the way.
  it.each([
    ["external", { ...ATS_JOB, apply_type: "external", url: "https://www.linkedin.com/jobs/view/1" }],
    ["auto", { ...ATS_JOB, apply_type: "auto", url: "https://www.linkedin.com/jobs/view/1" }],
    ["extension", { ...ATS_JOB, apply_type: "extension", url: "https://www.linkedin.com/jobs/view/1" }],
  ])("routes an %s one to the extension, creating and charging nothing", async (_type, job) => {
    sqlRouter(job);
    const res = await quickApply(post("/api/apply/quick", { jobId: "j1" }));
    expect(await res.json()).toMatchObject({ needs_extension: true });
    expect(mdb.$executeRaw).not.toHaveBeenCalled();
    const inserts = mdb.$queryRaw.mock.calls.filter(([s]) => s.join("?").includes("INSERT"));
    expect(inserts).toHaveLength(0);
    expect(charge).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("still treats a non-LinkedIn external job as external", async () => {
    sqlRouter({ ...ATS_JOB, apply_type: "external", url: "https://acme.example/careers/1" });
    const res = await quickApply(post("/api/apply/quick", { jobId: "j1" }));
    expect(await res.json()).toMatchObject({ status: "external", external_url: "https://acme.example/careers/1" });
  });

  it("submits to the ATS when a LinkedIn listing has a resolved apply_url", async () => {
    sqlRouter({ ...ATS_JOB, apply_type: "auto", url: "https://www.linkedin.com/jobs/view/1", apply_url: "https://boards.greenhouse.io/acme/jobs/1" });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, status: "applying" }) });
    const res = await quickApply(post("/api/apply/quick", { jobId: "j1" }));
    expect((await res.json()).needs_extension).toBeUndefined();
    expect(charge).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/apply/batch-mark-pending", () => {
  beforeEach(() => {
    mdb.job.findMany.mockResolvedValue([
      { id: "j1", url: "https://www.linkedin.com/jobs/view/1" },
      { id: "j2", url: "https://www.linkedin.com/jobs/view/2" },
    ]);
    mdb.application.findFirst.mockResolvedValue(null);
    mdb.application.create.mockImplementation(({ data }) => Promise.resolve({ id: `app-${data.job_id}` }));
  });

  it("refuses without the LinkedIn automation consent, queueing and charging nothing", async () => {
    mdb.user.findUnique.mockResolvedValue({ plan: "free", linkedin_automation_consent_at: null });
    const res = await batchMarkPending(post("/api/apply/batch-mark-pending", { jobIds: ["j1", "j2"] }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("linkedin_consent_required");
    expect(charge).not.toHaveBeenCalled();
    expect(mdb.application.create).not.toHaveBeenCalled();
  });

  it("charges each queued job and marks it as holding a credit", async () => {
    const res = await batchMarkPending(post("/api/apply/batch-mark-pending", { jobIds: ["j1", "j2"] }));
    const data = await res.json();

    expect(charge).toHaveBeenCalledTimes(2);
    expect(data.results).toHaveLength(2);
    expect(mdb.application.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ auto_apply_charged: true }) }),
    );
  });

  it("stops queueing when the limit runs out mid-batch", async () => {
    charge.mockResolvedValueOnce({ allowed: true, remaining: 0 }).mockResolvedValueOnce({ allowed: false, remaining: 0 });

    const data = await (await batchMarkPending(post("/api/apply/batch-mark-pending", { jobIds: ["j1", "j2"] }))).json();

    expect(data.results.map((r: { jobId: string }) => r.jobId)).toEqual(["j1"]);
    expect(data.limitReached).toEqual(["j2"]);
  });

  it("returns the limit 403 when nothing could be queued", async () => {
    charge.mockResolvedValue({ allowed: false, remaining: 0 });
    const res = await batchMarkPending(post("/api/apply/batch-mark-pending", { jobIds: ["j1", "j2"] }));
    expect(res.status).toBe(403);
    expect(mdb.application.create).not.toHaveBeenCalled();
  });

  it("doesn't charge again for a job that already holds a credit", async () => {
    mdb.application.findFirst.mockResolvedValue({ id: "app-x", auto_apply_charged: true });
    await batchMarkPending(post("/api/apply/batch-mark-pending", { jobIds: ["j1", "j2"] }));
    expect(charge).not.toHaveBeenCalled();
  });

  it("queues and charges only LinkedIn listings", async () => {
    mdb.job.findMany.mockResolvedValue([
      { id: "j1", url: "https://www.linkedin.com/jobs/view/1" },
      { id: "j2", url: "https://acme.example/careers/2" },
      { id: "j3", url: "https://boards.greenhouse.io/acme/jobs/3" },
    ]);
    const data = await (await batchMarkPending(post("/api/apply/batch-mark-pending", { jobIds: ["j1", "j2", "j3"] }))).json();
    expect(data.results.map((r: { jobId: string }) => r.jobId)).toEqual(["j1"]);
    expect(charge).toHaveBeenCalledTimes(1);
  });

  // The extension stops after MAX_EXTENSION_BATCH applications in an hour, so
  // a bigger batch could never finish. The rest must cost nothing.
  it("queues at most MAX_EXTENSION_BATCH jobs and charges nothing for the rest", async () => {
    const many = Array.from({ length: MAX_EXTENSION_BATCH + 3 }, (_, i) => ({
      id: `j${i}`,
      url: `https://www.linkedin.com/jobs/view/${4000000000 + i}`,
    }));
    mdb.job.findMany.mockResolvedValue(many);
    const data = await (await batchMarkPending(post("/api/apply/batch-mark-pending", { jobIds: many.map((j) => j.id) }))).json();
    expect(data.results).toHaveLength(MAX_EXTENSION_BATCH);
    expect(data.overBatchLimit).toHaveLength(3);
    expect(charge).toHaveBeenCalledTimes(MAX_EXTENSION_BATCH);
    expect(mdb.application.create).toHaveBeenCalledTimes(MAX_EXTENSION_BATCH);
  });
});

describe("POST /api/applications/update-status", () => {
  it.each(["manual", "failed"])("refunds the credit when the extension reports %s", async (status) => {
    await updateStatus(post("/api/applications/update-status", { applicationId: "app-1", status }));
    expect(refundForApp).toHaveBeenCalledWith("app-1", "u1");
  });

  it("keeps the credit when the extension reports applied", async () => {
    await updateStatus(post("/api/applications/update-status", { applicationId: "app-1", status: "applied" }));
    expect(refundForApp).not.toHaveBeenCalled();
  });

  // When a batch stops, the extension hands back everything it didn't get to.
  // That list can include an application that had just been submitted.
  it.each(["applied", "interviewing", "offer", "rejected"])(
    "doesn't refund or change an application that is already %s",
    async (current) => {
      mdb.$queryRaw.mockResolvedValue([{ status: current }]);
      const res = await updateStatus(post("/api/applications/update-status", { applicationId: "app-1", status: "manual" }));
      expect(await res.json()).toMatchObject({ success: true, unchanged: true });
      expect(refundForApp).not.toHaveBeenCalled();
      expect(mdb.$executeRaw).not.toHaveBeenCalled();
    },
  );

  it("refunds and marks manual an application that is still pending", async () => {
    mdb.$queryRaw.mockResolvedValue([{ status: "pending_extension" }]);
    await updateStatus(post("/api/applications/update-status", { applicationId: "app-1", status: "manual" }));
    expect(refundForApp).toHaveBeenCalledWith("app-1", "u1");
    expect(mdb.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
