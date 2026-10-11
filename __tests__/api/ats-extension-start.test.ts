import { NextRequest } from "next/server";

// Stage 3: a Greenhouse application handed to the extension. Charged once,
// only with the flag on, the job-site notice accepted and a Greenhouse job;
// the quick-apply route refuses to submit Greenhouse server-side meanwhile.

const setFlag = (on: boolean) => { process.env.NEXT_PUBLIC_GREENHOUSE_VIA_EXTENSION = on ? "true" : ""; };
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
  },
}));
jest.mock("@/lib/usage", () => ({
  ...jest.requireActual("@/lib/usage"),
  checkAndIncrementAutoApply: jest.fn(),
  refundAutoApplyForApplication: jest.fn(),
}));
jest.mock("@/lib/extension-token", () => ({ getSessionOrExtensionUserId: async () => "u1" }));

import { db } from "@/lib/db";
import * as usage from "@/lib/usage";
import { POST as start } from "@/app/api/apply/ats-extension/start/route";
import { GET as consentGet, POST as consentPost } from "@/app/api/apply/job-site-consent/route";
import { POST as quickApply } from "@/app/api/apply/quick/route";
import { POST as updateStatus } from "@/app/api/applications/update-status/route";

const mdb = db as unknown as {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  user: { findUnique: jest.Mock; findFirst: jest.Mock };
};
const charge = usage.checkAndIncrementAutoApply as jest.Mock;
const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) });

const GREENHOUSE = { url: "https://job-boards.greenhouse.io/acme/jobs/1", apply_url: null, apply_type: "auto" };

function rows({ job = GREENHOUSE as Record<string, unknown> | null, existing = [] as Record<string, unknown>[] } = {}) {
  mdb.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes('FROM "Job"')) return Promise.resolve(job ? [{ ...job, title: "Engineer", company: "Acme" }] : []);
    if (sql.includes('FROM "Application"')) return Promise.resolve(existing);
    if (sql.includes('INSERT INTO "Application"')) return Promise.resolve([{ id: "app-new" }]);
    return Promise.resolve([]);
  });
}

afterAll(() => { delete process.env.NEXT_PUBLIC_GREENHOUSE_VIA_EXTENSION; });

beforeEach(() => {
  jest.clearAllMocks();
  setFlag(true);
  mdb.user.findUnique.mockResolvedValue({ plan: "pro", job_site_automation_consent_at: new Date("2026-10-11T10:00:00Z") });
  charge.mockResolvedValue({ allowed: true, remaining: 9 });
  global.fetch = jest.fn();
});

describe("POST /api/apply/ats-extension/start", () => {
  it("charges once and hands a new Greenhouse application to the extension", async () => {
    rows();
    const res = await start(post("/api/apply/ats-extension/start", { jobId: "j1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ application_id: "app-new" });
    expect(charge).toHaveBeenCalledTimes(1);
    const insert = mdb.$queryRaw.mock.calls.find(([s]) => s.join("?").includes("INSERT"));
    expect(insert![0].join("?")).toContain("'pending_extension'");
  });

  it("doesn't charge again for an application that already holds a credit", async () => {
    rows({ existing: [{ id: "app-1", status: "needs_manual", auto_apply_charged: true }] });
    const res = await start(post("/api/apply/ats-extension/start", { jobId: "j1" }));
    expect(await res.json()).toEqual({ application_id: "app-1" });
    expect(charge).not.toHaveBeenCalled();
  });

  it.each([
    ["the flag is off", () => setFlag(false), 404],
    ["the job-site notice hasn't been accepted", () => mdb.user.findUnique.mockResolvedValue({ plan: "pro", job_site_automation_consent_at: null }), 403],
    ["the job isn't on Greenhouse", () => rows({ job: { url: "https://jobs.lever.co/acme/1", apply_url: null, apply_type: "auto" } }), 400],
    ["it was already applied to", () => rows({ existing: [{ id: "app-1", status: "applied", auto_apply_charged: false }] }), 409],
    ["no auto-apply is left", () => charge.mockResolvedValue({ allowed: false, remaining: 0 }), 403],
  ])("charges and marks nothing when %s", async (_what, arrange, status) => {
    rows();
    arrange();
    const res = await start(post("/api/apply/ats-extension/start", { jobId: "j1" }));
    expect(res.status).toBe(status);
    expect(mdb.$executeRaw).not.toHaveBeenCalled();
    expect(mdb.$queryRaw.mock.calls.some(([s]) => s.join("?").includes("INSERT"))).toBe(false);
    if (status !== 403 || _what.includes("notice")) expect(charge).not.toHaveBeenCalled();
  });
});

describe("POST /api/apply/quick for Greenhouse", () => {
  it("doesn't submit server-side while Greenhouse goes through the extension", async () => {
    rows();
    const res = await quickApply(post("/api/apply/quick", { jobId: "j1" }));
    expect(await res.json()).toMatchObject({ extension_required: true });
    expect(charge).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("still submits server-side with the flag off", async () => {
    setFlag(false);
    rows();
    mdb.user.findFirst.mockResolvedValue({ first_name: "A", last_name: "B", email: "u1@example.com", phone: null, linkedin_url: null });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, status: "applying" }) });
    const res = await quickApply(post("/api/apply/quick", { jobId: "j1" }));
    expect((await res.json()).status).toBe("applying");
  });
});

describe("/api/apply/job-site-consent", () => {
  it("records consent only when the box was ticked", async () => {
    expect((await consentPost(post("/api/apply/job-site-consent", {}))).status).toBe(400);
    expect(mdb.$executeRaw).not.toHaveBeenCalled();
    const res = await consentPost(post("/api/apply/job-site-consent", { understood: true }));
    expect(res.status).toBe(200);
    expect(mdb.$executeRaw.mock.calls[0][0].join("?")).toContain("job_site_automation_consent_at");
    expect((await (await consentGet()).json()).consented).toBe(true);
  });
});

describe("POST /api/applications/update-status from the extension", () => {
  beforeEach(() => mdb.$queryRaw.mockResolvedValue([{ status: "pending_extension" }]));

  it("stores the questions it stopped on with a manual outcome", async () => {
    await updateStatus(post("/api/applications/update-status", {
      applicationId: "app-1", status: "manual",
      missingQuestions: [{ question: "How did you hear about us?", options: ["LinkedIn", 3, "Other"] }, { question: "  " }, "junk"],
    }));
    const args = mdb.$executeRaw.mock.calls[0];
    expect(args[0].join("?")).toContain("missing_questions");
    expect(JSON.parse(args[2])).toEqual([{ question: "How did you hear about us?", options: ["LinkedIn", "Other"] }]);
  });

  it("stores none for an applied outcome", async () => {
    await updateStatus(post("/api/applications/update-status", {
      applicationId: "app-1", status: "applied", missingQuestions: [{ question: "Q", options: [] }],
    }));
    expect(mdb.$executeRaw.mock.calls[0][2]).toBeNull();
  });
});
