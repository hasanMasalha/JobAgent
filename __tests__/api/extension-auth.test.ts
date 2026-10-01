import { NextRequest } from "next/server";

// The routes the Chrome extension calls must never act on a caller-supplied
// user id. Only a session or a valid signed extension token identifies the
// caller. These requests come with NO session, as an attacker's would.

let sessionUser: { id: string } | null = null;
jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
}));

jest.mock("@/lib/db", () => ({
  db: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    easyApplyAnswer: { findMany: jest.fn(), upsert: jest.fn() },
  },
}));

jest.mock("@/lib/usage", () => ({
  ...jest.requireActual("@/lib/usage"),
  refundAutoApplyForApplication: jest.fn(),
}));

import { db } from "@/lib/db";
import * as usage from "@/lib/usage";
import { createExtensionToken } from "@/lib/extension-token";
import { GET as checkPending } from "@/app/api/apply/check-pending/route";
import { POST as updateStatus } from "@/app/api/applications/update-status/route";
import { POST as saveAnswer } from "@/app/api/apply/answers/route";

const mdb = db as unknown as {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  user: { findUnique: jest.Mock };
  easyApplyAnswer: { findMany: jest.Mock; upsert: jest.Mock };
};
const refund = usage.refundAutoApplyForApplication as jest.Mock;

const VICTIM = "victim-user-id";
const ME = "extension-user-id";

// Sent as the current extension would: with its version (older versions get
// no application — see linkedin-apply-safety.test.ts).
const req = (url: string, init: { method?: string; body?: unknown; token?: string } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "X-JobAgent-Extension-Version": "1.5.0", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  sessionUser = null;
  process.env.EXTENSION_TOKEN_SECRET = "test-secret-that-is-at-least-32-characters-long";
  // Any lookup "finds" a pending application, so a leak would be visible.
  mdb.$queryRaw.mockResolvedValue([{ id: "app-1", job_url: "https://www.linkedin.com/jobs/view/1", skills_json: [] }]);
  mdb.user.findUnique.mockResolvedValue({ first_name: "Victim", phone: "+1 555 0100" });
  mdb.easyApplyAnswer.findMany.mockResolvedValue([]);
});

describe("a bare userId is not identity", () => {
  it("check-pending: 401 and no profile data for ?userId=<victim>", async () => {
    const res = await checkPending(req(`/api/apply/check-pending?userId=${VICTIM}&jobId=%25`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/Victim|555/);
    expect(mdb.user.findUnique).not.toHaveBeenCalled();
  });

  it("update-status: 401, no status change and no refund for a body userId", async () => {
    const res = await updateStatus(req("/api/applications/update-status", {
      method: "POST", body: { applicationId: "app-1", status: "failed", userId: VICTIM },
    }));
    expect(res.status).toBe(401);
    expect(mdb.$executeRaw).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });

  it("answers: 401 and nothing written for a body userId", async () => {
    const res = await saveAnswer(req("/api/apply/answers", {
      method: "POST", body: { userId: VICTIM, question: "Expected salary?", answer: "1" },
    }));
    expect(res.status).toBe(401);
    expect(mdb.easyApplyAnswer.upsert).not.toHaveBeenCalled();
  });

  it("rejects a forged token", async () => {
    const res = await checkPending(req(`/api/apply/check-pending?jobId=1`, { token: "v1.dmljdGlt.9999999999.forged" }));
    expect(res.status).toBe(401);
  });
});

describe("a valid extension token acts as its own user only", () => {
  it("update-status uses the token's user and ignores a body userId", async () => {
    const token = createExtensionToken(ME)!;
    const res = await updateStatus(req("/api/applications/update-status", {
      method: "POST", token, body: { applicationId: "app-1", status: "failed", userId: VICTIM },
    }));
    expect(res.status).toBe(200);
    expect(refund).toHaveBeenCalledWith("app-1", ME);
    const values = mdb.$executeRaw.mock.calls[0].slice(1);
    expect(values).toContain(ME);
    expect(values).not.toContain(VICTIM);
  });

  it("answers writes under the token's user, not the body userId", async () => {
    const token = createExtensionToken(ME)!;
    await saveAnswer(req("/api/apply/answers", {
      method: "POST", token, body: { userId: VICTIM, question: "Notice period?", answer: "30" },
    }));
    expect(mdb.easyApplyAnswer.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { user_id_question: { user_id: ME, question: "Notice period?" } },
    }));
  });

  it("check-pending returns the token user's pending application", async () => {
    const token = createExtensionToken(ME)!;
    const res = await checkPending(req(`/api/apply/check-pending?jobId=1&userId=${VICTIM}`, { token }));
    expect(res.status).toBe(200);
    expect(mdb.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ME } }));
  });
});

describe("a signed-in session still works without a token", () => {
  it("update-status acts as the session user", async () => {
    sessionUser = { id: ME };
    const res = await updateStatus(req("/api/applications/update-status", {
      method: "POST", body: { applicationId: "app-1", status: "applied", userId: VICTIM },
    }));
    expect(res.status).toBe(200);
    expect(mdb.$executeRaw.mock.calls[0].slice(1)).toContain(ME);
  });
});
