import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

const anthropic = new Anthropic({ maxRetries: 3 });

export async function POST() {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await db.$queryRaw<{ id: string; raw_text: string }[]>`
      SELECT id, raw_text FROM "CV" WHERE user_id = ${user.id} LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ error: "No CV found" }, { status: 404 });
    }

    const { id: cvId, raw_text } = rows[0];

    const prompt =
      `You are a professional CV writer. Rewrite the CV below to maximise its quality and ATS score.\n\n` +
      `Apply ALL of these improvements:\n` +
      `- Replace weak verbs (worked on, helped, assisted) with strong action verbs (built, led, engineered, improved)\n` +
      `- Add quantified achievements wherever possible (e.g. "reduced load time by 40%", "managed team of 5")\n` +
      `- Remove generic phrases like "team player", "hard worker", "results-driven"\n` +
      `- Ensure a professional summary is present (2 sentences max)\n` +
      `- Keep the CV to one page — under 500 words\n` +
      `- Maintain plain text format with bullet points starting with "• "\n` +
      `- Keep all real facts — do not invent experience or skills\n` +
      `- Preserve the same section structure and contact info\n\n` +
      `Return ONLY the improved CV text, no explanation or preamble.\n\n` +
      `CV:\n${raw_text}`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const improvedText = (message.content[0] as { text: string }).text.trim();

    if (!improvedText) {
      return NextResponse.json({ error: "Claude returned empty CV" }, { status: 500 });
    }

    // Save improved CV back to DB (upsert)
    await db.$executeRaw`
      UPDATE "CV"
      SET raw_text = ${improvedText}, updated_at = now()
      WHERE id = ${cvId}
    `;

    return NextResponse.json({ cv_text: improvedText, cv_id: cvId });
  } catch (err) {
    console.error("[cv/improve]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
