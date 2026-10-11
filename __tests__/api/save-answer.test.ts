import { NextRequest } from "next/server";

// Answers saved from the Applications page and fill-and-review (and the
// extension): the user's own answer to one question, used for that exact
// question by every filler.

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));
jest.mock("@/lib/db", () => ({ db: { easyApplyAnswer: { upsert: jest.fn() } } }));

import { db } from "@/lib/db";
import { POST as saveAnswer } from "@/app/api/apply/answers/route";
import { questionKey } from "@/lib/question-key";

const upsert = (db as unknown as { easyApplyAnswer: { upsert: jest.Mock } }).easyApplyAnswer.upsert;
const post = (body: unknown) =>
  saveAnswer(new NextRequest("http://localhost/api/apply/answers", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => jest.clearAllMocks());

describe("POST /api/apply/answers", () => {
  it("saves the session user's answer for the question", async () => {
    const res = await post({ question: "How did you hear about ElevenLabs?", answer: "LinkedIn" });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { user_id_question: { user_id: "u1", question: "How did you hear about ElevenLabs?" } },
      create: { user_id: "u1", question: "How did you hear about ElevenLabs?", answer: "LinkedIn" },
    }));
  });

  it.each([
    ["no question", { answer: "x" }],
    ["a blank question", { question: "  ", answer: "x" }],
    ["a non-text answer", { question: "Q", answer: 3 }],
    ["an over-long question", { question: "q".repeat(1001), answer: "x" }],
    ["an over-long answer", { question: "Q", answer: "a".repeat(2001) }],
  ])("rejects %s", async (_what, body) => {
    expect((await post(body)).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});

// Same results as ai-service application_answers.normalize(), which the
// fillers look saved answers up by.
describe("questionKey", () => {
  it.each([
    ["How did you hear about ElevenLabs? ", "how did you hear about elevenlabs?"],
    ["  Notice   period *", "notice period"],
    ["Visa status: What is your right to work or visa status?", "visa status: what is your right to work or visa status?"],
    ["Location", "location"],
  ])("%j → %j", (q, key) => {
    expect(questionKey(q)).toBe(key);
  });
});
