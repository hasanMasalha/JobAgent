import { createHash } from "crypto";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

// The CV score is cached on the CV row (score_json), keyed by a SHA-256 of
// raw_text (score_text_hash). My CV requests it on every visit, so without
// the cache each page load was a Claude call. Any change to the CV text —
// upload, generate, AI improve — changes the hash and re-scores once.

type CVScore = {
  score: number;
  grade: "A" | "B" | "C" | "D";
  summary: string;
  strengths: string[];
  improvements: { issue: string; fix: string; priority: "high" | "medium" }[];
};

const hashCvText = (text: string) => createHash("sha256").update(text).digest("hex");

function isCVScore(v: unknown): v is CVScore {
  const s = v as CVScore;
  return (
    !!s &&
    typeof s.score === "number" &&
    ["A", "B", "C", "D"].includes(s.grade) &&
    typeof s.summary === "string" &&
    Array.isArray(s.strengths) &&
    Array.isArray(s.improvements)
  );
}

export async function POST() {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await db.$queryRaw<{ raw_text: string; score_json: unknown; score_text_hash: string | null }[]>`
      SELECT raw_text, score_json, score_text_hash FROM "CV" WHERE user_id = ${user.id} LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ error: "No CV found" }, { status: 404 });
    }

    const { raw_text, score_json, score_text_hash } = rows[0];
    const textHash = hashCvText(raw_text);

    if (score_text_hash === textHash && isCVScore(score_json)) {
      return NextResponse.json(score_json);
    }

    const prompt =
      `Score this CV on a scale of 0-100 and give specific improvement tips. Return ONLY valid JSON, no markdown:\n` +
      `{\n` +
      `  "score": number,\n` +
      `  "grade": "A" | "B" | "C" | "D",\n` +
      `  "summary": "one sentence overall assessment",\n` +
      `  "strengths": ["thing done well 1", "thing done well 2"],\n` +
      `  "improvements": [\n` +
      `    { "issue": "string", "fix": "string", "priority": "high" | "medium" }\n` +
      `  ]\n` +
      `}\n\n` +
      `Score based on:\n` +
      `- Has quantified achievements (numbers, percentages, scale)\n` +
      `- Strong action verbs (built, led, improved vs worked on, helped)\n` +
      `- Relevant skills clearly listed\n` +
      `- Clear job titles and dates\n` +
      `- Professional summary present\n` +
      `- Appropriate length (not too long, not too short)\n` +
      `- No generic phrases ('team player', 'hard worker')\n\n` +
      `Grade mapping: A = 80-100, B = 60-79, C = 40-59, D = below 40\n\n` +
      `CV:\n${raw_text}`;

    const anthropic = new Anthropic({ maxRetries: 3 });
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    let raw = (message.content[0] as { text: string }).text.trim();
    if (raw.startsWith("```")) {
      raw = raw.split("\n").slice(1).join("\n");
      const fence = raw.lastIndexOf("```");
      if (fence !== -1) raw = raw.slice(0, fence).trim();
    }

    const result: unknown = JSON.parse(raw);
    if (!isCVScore(result)) {
      console.error("[cv/score] unexpected response shape, not caching:", raw.slice(0, 200));
      return NextResponse.json({ error: "Couldn't score your CV. Please try again." }, { status: 502 });
    }

    // Keyed to the text that was scored. $executeRaw doesn't touch the
    // @updatedAt column, so caching doesn't change "Last updated".
    await db.$executeRaw`
      UPDATE "CV" SET score_json = ${JSON.stringify(result)}::jsonb, score_text_hash = ${textHash}
      WHERE user_id = ${user.id}
    `;

    return NextResponse.json(result);
  } catch (err) {
    console.error("[cv/score]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
