import { NextRequest } from "next/server";

// Service-to-service auth. Next.js must always send X-Internal-Key to the AI
// service, and the internal-only email routes must accept nothing but that
// key — in particular not a Host or X-Forwarded-For claiming "localhost",
// which any caller can set.

let sessionUser: { id: string } | null = null;
jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}));
jest.mock("@/lib/db", () => ({
  db: { $queryRaw: jest.fn(), job: { findUnique: jest.fn(), update: jest.fn() } },
}));
jest.mock("@/lib/email", () => ({
  sendApplicationConfirmationEmail: jest.fn(),
  sendNeedsManualEmail: jest.fn(),
  sendDailyMatchEmail: jest.fn(),
}));
jest.mock("@/lib/generate-cv", () => ({ generateCVDocx: jest.fn() }));

import { db } from "@/lib/db";
import { isInternalRequest } from "@/lib/internal-auth";
import { pythonFetch } from "@/lib/python-service";
import { POST as sendConfirmation } from "@/app/api/email/send-application-confirmation/route";
import { POST as sendMatches } from "@/app/api/email/send-matches/route";
import { POST as checkStatus } from "@/app/api/jobs/check-status/route";

const queryRaw = db.$queryRaw as unknown as jest.Mock;
const mjob = (db as unknown as { job: { findUnique: jest.Mock; update: jest.Mock } }).job;
const KEY = "test-internal-key-0123456789abcdef";

const req = (url: string, headers: Record<string, string>, body: unknown = {}) =>
  new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env.INTERNAL_API_KEY = KEY;
  process.env.PYTHON_SERVICE_URL = "http://fastapi:8000";
  fetchMock.mockResolvedValue(new Response("{}"));
  global.fetch = fetchMock as unknown as typeof fetch;
  queryRaw.mockResolvedValue([]);
  sessionUser = null;
});

describe("pythonFetch", () => {
  const sentHeaders = () => fetchMock.mock.calls[0][1].headers as Headers;

  it("adds the base URL and X-Internal-Key", async () => {
    await pythonFetch("/match-jobs", { method: "POST", body: "{}" });
    expect(fetchMock.mock.calls[0][0]).toBe("http://fastapi:8000/match-jobs");
    expect(sentHeaders().get("x-internal-key")).toBe(KEY);
  });

  it("keeps the caller's headers and doesn't let them replace the key", async () => {
    await pythonFetch("/ats-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Key": "caller-supplied" },
    });
    expect(sentHeaders().get("content-type")).toBe("application/json");
    expect(sentHeaders().get("x-internal-key")).toBe(KEY);
  });

  it("works with no init and still sends the key", async () => {
    await pythonFetch("/linkedin/session-status/u1");
    expect(sentHeaders().get("x-internal-key")).toBe(KEY);
  });
});

describe("isInternalRequest", () => {
  it("accepts only the exact key, in the named header", () => {
    expect(isInternalRequest(req("http://x/", { "x-internal-key": KEY }))).toBe(true);
    expect(isInternalRequest(req("http://x/", { "x-internal-key": KEY + "x" }))).toBe(false);
    expect(isInternalRequest(req("http://x/", { "x-internal-key": "" }))).toBe(false);
    expect(isInternalRequest(req("http://x/", { "x-api-key": KEY }))).toBe(false);
    expect(isInternalRequest(req("http://x/", { "x-api-key": KEY }), "x-api-key")).toBe(true);
  });

  it("fails closed when INTERNAL_API_KEY is unset", () => {
    delete process.env.INTERNAL_API_KEY;
    expect(isInternalRequest(req("http://x/", { "x-internal-key": "" }))).toBe(false);
    expect(isInternalRequest(req("http://x/", { "x-internal-key": "undefined" }))).toBe(false);
  });
});

describe.each([
  ["send-application-confirmation", sendConfirmation, { application_id: "app-1" }],
  ["send-matches", sendMatches, { user_id: "victim" }],
])("POST /api/email/%s", (name, handler, body) => {
  const url = `http://localhost:3000/api/email/${name}`;

  it.each([
    ["no headers", {}],
    ["Host: localhost", { host: "localhost:3000" }],
    ["Host: 127.0.0.1", { host: "127.0.0.1:3000" }],
    ["X-Forwarded-For: 127.0.0.1", { "x-forwarded-for": "127.0.0.1" }],
    ["all of them", { host: "localhost", "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1" }],
    ["wrong key", { "x-internal-key": "wrong" }],
  ])("rejects %s", async (_label, headers) => {
    const res = await handler(req(url, headers, body));
    expect(res.status).toBe(403);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("runs with the right key", async () => {
    const res = await handler(req(url, { "x-internal-key": KEY }, body));
    expect(res.status).not.toBe(403);
    expect(queryRaw).toHaveBeenCalled();
  });
});

describe("POST /api/jobs/check-status", () => {
  const url = "http://localhost:3000/api/jobs/check-status";
  const closed = () => fetchMock.mockResolvedValue(new Response(JSON.stringify({ is_closed: true })));

  it("refuses a caller with no session and never reaches the AI service", async () => {
    closed();
    const res = await checkStatus(req(url, {}, { jobId: "job-1", url: "https://closed.example" }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mjob.update).not.toHaveBeenCalled();
  });

  it("checks the job's stored URL, not the one in the body", async () => {
    sessionUser = { id: "u1" };
    closed();
    mjob.findUnique.mockResolvedValue({ url: "https://boards.greenhouse.io/acme/jobs/1" });
    const res = await checkStatus(req(url, {}, { jobId: "job-1", url: "http://169.254.169.254/latest/meta-data" }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://fastapi:8000/test-job-check?url=" + encodeURIComponent("https://boards.greenhouse.io/acme/jobs/1"),
    );
    expect(mjob.update).toHaveBeenCalledWith({ where: { id: "job-1" }, data: { is_active: false } });
  });

  it("does nothing for an unknown job", async () => {
    sessionUser = { id: "u1" };
    closed();
    mjob.findUnique.mockResolvedValue(null);
    const res = await checkStatus(req(url, {}, { jobId: "nope", url: "https://closed.example" }));
    expect(await res.json()).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mjob.update).not.toHaveBeenCalled();
  });
});
