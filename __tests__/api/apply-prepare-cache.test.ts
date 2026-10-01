import { createHash } from "crypto";
import { NextRequest } from "next/server";

// The apply page calls /api/apply/prepare on every load. A draft tailored
// from the CV the user still has must come back as is: no Claude call and no
// tailoring credit. Both are spent only on a first visit or after the CV
// text has changed.

const create = jest.fn();
jest.mock("@anthropic-ai/sdk", () => jest.fn().mockImplementation(() => ({ messages: { create } })));

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));

jest.mock("@/lib/db", () => ({
  db: { $queryRaw: jest.fn(), $executeRaw: jest.fn(), user: { findUnique: jest.fn() } },
}));

const charge = jest.fn();
jest.mock("@/lib/usage", () => ({ checkAndIncrementCvTailoring: (...a: unknown[]) => charge(...a) }));

import { db } from "@/lib/db";
import { POST } from "@/app/api/apply/prepare/route";

const mdb = db as unknown as {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  user: { findUnique: jest.Mock };
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const CV = "Dana Levi\nFrontend engineer";
const JOB = { title: "Senior Frontend Engineer", company: "Torq", description: "React", url: "https://example.com/job", match_score: 0.7 };
const TAILORED = { cover_letter: "Dear Torq,", cv_changes: ["Led with React"], tailored_cv: "Dana Levi\nReact engineer" };
const DRAFT = { id: "app-1", cover_letter: "Dear Torq (edited),", tailored_cv: "Dana Levi\nOld tailoring", cv_changes: ["Old change"], tailored_cv_hash: sha(CV) };

const claudeReturns = (text: string) => create.mockResolvedValue({ content: [{ type: "text", text }] });
const call = () =>
  POST(new NextRequest("http://localhost/api/apply/prepare", { method: "POST", body: JSON.stringify({ job_id: "job-1" }) }));

// Queries run in this order: CV, job, draft, then the INSERT for a new draft.
function dbReturns(cvText: string, draft: unknown[]) {
  mdb.$queryRaw
    .mockResolvedValueOnce([{ raw_text: cvText }])
    .mockResolvedValueOnce([JOB])
    .mockResolvedValueOnce(draft)
    .mockResolvedValueOnce([{ id: "app-new" }]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mdb.$queryRaw.mockReset(); // drops unused mockResolvedValueOnce values from the previous test
  jest.spyOn(console, "error").mockImplementation(() => {});
  mdb.$executeRaw.mockResolvedValue(1);
  mdb.user.findUnique.mockResolvedValue({ plan: "free" });
  charge.mockResolvedValue({ allowed: true, remaining: 4 });
});

it("returns the draft without charging or calling Claude when the CV is unchanged", async () => {
  dbReturns(CV, [DRAFT]);
  const res = await call();
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    application_id: "app-1",
    cover_letter: DRAFT.cover_letter,
    tailored_cv: DRAFT.tailored_cv,
    cv_changes: ["Old change"],
  });
  expect(charge).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(mdb.$executeRaw).not.toHaveBeenCalled();
});

it("returns the draft even when the monthly limit is spent", async () => {
  charge.mockResolvedValue({ allowed: false, remaining: 0 });
  dbReturns(CV, [DRAFT]);
  const res = await call();
  expect(res.status).toBe(200);
});

it("reuses a draft made before the hash existed, with an empty change list", async () => {
  dbReturns(CV, [{ ...DRAFT, cv_changes: null, tailored_cv_hash: null }]);
  const res = await call();
  expect((await res.json()).cv_changes).toEqual([]);
  expect(charge).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it("charges once, tailors and saves a new draft on a first visit", async () => {
  dbReturns(CV, []);
  claudeReturns("```json\n" + JSON.stringify(TAILORED) + "\n```");
  const res = await call();
  expect(await res.json()).toMatchObject({ application_id: "app-new", ...TAILORED });
  expect(charge).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  // The INSERT stores the hash of the CV that was tailored.
  expect(mdb.$queryRaw.mock.calls[3]).toContain(sha(CV));
});

it("tailors again into the same draft when the CV text has changed", async () => {
  dbReturns(CV + "\nNew role", [DRAFT]);
  claudeReturns(JSON.stringify(TAILORED));
  const res = await call();
  expect(await res.json()).toMatchObject({ application_id: "app-1", ...TAILORED });
  expect(charge).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
  expect(mdb.$executeRaw).toHaveBeenCalledTimes(1);
  expect(mdb.$executeRaw.mock.calls[0]).toContain(sha(CV + "\nNew role"));
});

it("returns the limit response without calling Claude when there is no draft and no credit", async () => {
  charge.mockResolvedValue({ allowed: false, remaining: 0 });
  dbReturns(CV, []);
  const res = await call();
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: "limit_reached", upgrade_url: "/pricing" });
  expect(create).not.toHaveBeenCalled();
});

it("doesn't save a response that isn't a valid tailoring", async () => {
  dbReturns(CV, []);
  claudeReturns(JSON.stringify({ cover_letter: "Dear Torq," }));
  const res = await call();
  expect(res.status).toBe(502);
  expect(mdb.$queryRaw).toHaveBeenCalledTimes(3);
  expect(mdb.$executeRaw).not.toHaveBeenCalled();
});
