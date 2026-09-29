import { createHash } from "crypto";

// My CV requests the score on every visit. Claude must be called only when
// the CV text has changed since the last score; otherwise the cached score
// on the CV row is returned.

const create = jest.fn();
jest.mock("@anthropic-ai/sdk", () => jest.fn().mockImplementation(() => ({ messages: { create } })));

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));

jest.mock("@/lib/db", () => ({ db: { $queryRaw: jest.fn(), $executeRaw: jest.fn() } }));

import { db } from "@/lib/db";
import { POST } from "@/app/api/cv/score/route";

const mdb = db as unknown as { $queryRaw: jest.Mock; $executeRaw: jest.Mock };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const CV = "Dana Levi\nFrontend engineer";
const SCORE = {
  score: 74, grade: "B", summary: "Solid.", strengths: ["React"],
  improvements: [{ issue: "No numbers", fix: "Add metrics", priority: "high" }],
};
const claudeReturns = (text: string) => create.mockResolvedValue({ content: [{ type: "text", text }] });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mdb.$executeRaw.mockResolvedValue(1);
});

it("returns the cached score without calling Claude when the CV text is unchanged", async () => {
  mdb.$queryRaw.mockResolvedValue([{ raw_text: CV, score_json: SCORE, score_text_hash: sha(CV) }]);
  const res = await POST();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(SCORE);
  expect(create).not.toHaveBeenCalled();
  expect(mdb.$executeRaw).not.toHaveBeenCalled();
});

it("re-scores once and stores the result when the CV text has changed", async () => {
  mdb.$queryRaw.mockResolvedValue([{ raw_text: CV + "\nNew role", score_json: SCORE, score_text_hash: sha(CV) }]);
  claudeReturns(JSON.stringify({ ...SCORE, score: 81, grade: "A" }));
  const res = await POST();
  expect((await res.json()).score).toBe(81);
  expect(create).toHaveBeenCalledTimes(1);
  expect(mdb.$executeRaw).toHaveBeenCalledTimes(1);
  // The stored hash is of the text that was just scored.
  expect(mdb.$executeRaw.mock.calls[0]).toContain(sha(CV + "\nNew role"));
});

it("scores and caches a CV that has never been scored", async () => {
  mdb.$queryRaw.mockResolvedValue([{ raw_text: CV, score_json: null, score_text_hash: null }]);
  claudeReturns("```json\n" + JSON.stringify(SCORE) + "\n```");
  const res = await POST();
  expect(await res.json()).toEqual(SCORE);
  expect(create).toHaveBeenCalledTimes(1);
  expect(mdb.$executeRaw).toHaveBeenCalledTimes(1);
});

it("doesn't cache a response that isn't a valid score", async () => {
  mdb.$queryRaw.mockResolvedValue([{ raw_text: CV, score_json: null, score_text_hash: null }]);
  claudeReturns(JSON.stringify({ score: "high" }));
  const res = await POST();
  expect(res.status).toBe(502);
  expect(mdb.$executeRaw).not.toHaveBeenCalled();
});

it("ignores a cached value with the right hash but a broken shape", async () => {
  mdb.$queryRaw.mockResolvedValue([{ raw_text: CV, score_json: { nope: true }, score_text_hash: sha(CV) }]);
  claudeReturns(JSON.stringify(SCORE));
  await POST();
  expect(create).toHaveBeenCalledTimes(1);
});
