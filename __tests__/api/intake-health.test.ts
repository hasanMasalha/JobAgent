import { NextRequest } from "next/server";

// /api/admin/intake-health: emails what's wrong with job intake, once per
// problem, and reports unhealthy whenever it can't (so the GitHub workflow
// fails instead). From 2026-10-20 to 2026-11-25 intake stored nothing and
// nothing said so.

jest.mock("@/lib/db", () => ({
  db: { $queryRaw: jest.fn(), $executeRaw: jest.fn(), $executeRawUnsafe: jest.fn() },
}));
jest.mock("@/lib/email", () => ({ sendIntakeAlert: jest.fn() }));

import { db } from "@/lib/db";
import { sendIntakeAlert } from "@/lib/email";
import { POST } from "@/app/api/admin/intake-health/route";

const queryRaw = db.$queryRaw as unknown as jest.Mock;
const executeRaw = db.$executeRaw as unknown as jest.Mock;
const send = sendIntakeAlert as jest.Mock;
const KEY = "test-internal-key-0123456789abcdef";

const req = (headers: Record<string, string> = { "x-api-key": KEY }) =>
  new NextRequest("https://jobagent.uk/api/admin/intake-health", { method: "POST", headers });

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000);
const zeroRun = {
  id: "r2", kind: "daily", trigger: "scheduler", status: "problems",
  started_at: hoursAgo(4), finished_at: hoursAgo(3), jobs_stored: 0, problems: ["The run stored 0 jobs"],
};

function dbHas(runs: unknown[], sent: { key: string; sent_at: Date }[] = []) {
  queryRaw.mockResolvedValueOnce(runs).mockResolvedValueOnce(sent);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env.INTERNAL_API_KEY = KEY;
  process.env.ALERT_EMAIL = "ops@example.com";
});

it("refuses a caller without the internal key", async () => {
  expect((await POST(req({}))).status).toBe(401);
  expect((await POST(req({ "x-api-key": "wrong" }))).status).toBe(401);
  expect(send).not.toHaveBeenCalled();
});

it("accepts the AI service's X-Internal-Key too", async () => {
  dbHas([{ ...zeroRun, status: "ok", jobs_stored: 900, problems: [] }]);
  const body = await (await POST(req({ "x-internal-key": KEY }))).json();
  expect(body).toMatchObject({ healthy: true, problems: [], emailed: 0 });
});

it("emails a run that stored nothing and records that it did", async () => {
  dbHas([zeroRun]);
  const body = await (await POST(req())).json();
  expect(body.healthy).toBe(false);
  expect(send).toHaveBeenCalledWith({ to: "ops@example.com", messages: [expect.stringContaining("stored 0 jobs")] });
  expect(body.emailed).toBe(1);
  const insert = (executeRaw.mock.calls[0][0] as TemplateStringsArray).join("?");
  expect(insert).toContain('INSERT INTO "IntakeAlert"');
  expect(executeRaw.mock.calls[0][1]).toBe("run:r2");
});

it("doesn't email the same run twice, but stays unhealthy", async () => {
  dbHas([zeroRun], [{ key: "run:r2", sent_at: hoursAgo(1) }]);
  const body = await (await POST(req())).json();
  expect(send).not.toHaveBeenCalled();
  expect(body).toMatchObject({ healthy: false, emailed: 0 });
});

it("emails when no daily run has happened for 48 hours", async () => {
  dbHas([{ ...zeroRun, status: "ok", problems: [], jobs_stored: 500, started_at: hoursAgo(50) }]);
  await POST(req());
  expect(send.mock.calls[0][0].messages[0]).toContain("No daily intake run has started since");
});

it("is unhealthy without ALERT_EMAIL, even when intake is fine", async () => {
  delete process.env.ALERT_EMAIL;
  dbHas([{ ...zeroRun, status: "ok", jobs_stored: 900, problems: [] }]);
  const body = await (await POST(req())).json();
  expect(body).toMatchObject({ healthy: false, emailError: "ALERT_EMAIL is not set" });
});

it("doesn't mark an alert sent when Resend refuses it", async () => {
  send.mockRejectedValueOnce(new Error("Resend refused the intake alert: domain not verified"));
  dbHas([zeroRun]);
  const body = await (await POST(req())).json();
  expect(body).toMatchObject({ healthy: false, emailed: 0 });
  expect(body.emailError).toContain("domain not verified");
  expect(executeRaw).not.toHaveBeenCalled();
});
