import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

const anthropic = new Anthropic();

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { message, history = [] } = await req.json();
  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: "message required" }), { status: 400 });
  }

  // Gather user context in parallel
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [cvRows, appRows, savedRows, matchRows] = await Promise.all([
    db.$queryRaw<{ clean_summary: string | null; skills_json: string | null }[]>`
      SELECT clean_summary, skills_json FROM "CV"
      WHERE user_id = ${user.id} LIMIT 1
    `,
    db.$queryRaw<{ company: string; title: string; status: string }[]>`
      SELECT j.company, j.title, a.status
      FROM "Application" a
      JOIN "Job" j ON j.id = a.job_id
      WHERE a.user_id = ${user.id}
      ORDER BY a.applied_at DESC
    `,
    db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "UserJobInteraction"
      WHERE user_id = ${user.id} AND action = 'saved'
    `,
    db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "Job"
      WHERE scraped_at >= ${today}
    `,
  ]);

  const cv = cvRows[0];
  const cleanSummary = cv?.clean_summary ?? "Not provided";
  const skills = cv?.skills_json ?? "Not provided";
  const savedCount = Number(savedRows[0]?.count ?? 0);
  const todayMatchCount = Number(matchRows[0]?.count ?? 0);

  const applicationsList =
    appRows.length === 0
      ? "No applications yet."
      : appRows.map((a) => `- ${a.title} at ${a.company} (${a.status})`).join("\n");

  const systemPrompt =
    `You are a job search assistant for this user. ` +
    `Answer questions about their job search concisely. ` +
    `User profile: ${cleanSummary} ` +
    `Skills: ${skills} ` +
    `Applications:\n${applicationsList}\n` +
    `Today's new jobs: ${todayMatchCount} ` +
    `Saved jobs: ${savedCount} ` +
    `Respond in 2-3 sentences max unless listing items.`;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  const stream = anthropic.messages.stream({
    model: "claude-3-5-haiku-20241022",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI error";
        controller.enqueue(encoder.encode(`Error: ${msg}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
