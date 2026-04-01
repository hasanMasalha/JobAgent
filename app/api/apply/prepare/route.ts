import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

const anthropic = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { job_id } = await req.json();
    if (!job_id) {
      return NextResponse.json({ error: "job_id required" }, { status: 400 });
    }

    // Fetch CV
    const cvRows = await db.$queryRaw<{ raw_text: string }[]>`
      SELECT raw_text FROM "CV" WHERE user_id = ${user.id} LIMIT 1
    `;
    if (!cvRows.length) {
      return NextResponse.json({ error: "No CV found. Please upload your CV first." }, { status: 404 });
    }
    const { raw_text } = cvRows[0];

    // Fetch Job
    const jobRows = await db.$queryRaw<{ title: string; company: string; description: string }[]>`
      SELECT title, company, description FROM "Job" WHERE id = ${job_id} LIMIT 1
    `;
    if (!jobRows.length) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    const job = jobRows[0];

    // Call Claude Sonnet to tailor CV
    const prompt =
      `Tailor this CV for this specific role.\n` +
      `Return ONLY valid JSON, no markdown:\n` +
      `{\n` +
      `  "cover_letter": "3 paragraphs, professional tone",\n` +
      `  "cv_changes": ["specific change 1", "specific change 2"],\n` +
      `  "tailored_summary": "2 sentence professional summary"\n` +
      `}\n\n` +
      `CV:\n${raw_text}\n\n` +
      `Job: ${job.title} at ${job.company}\n` +
      `Description: ${job.description.slice(0, 2000)}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    let raw = (message.content[0] as { text: string }).text.trim();
    if (raw.startsWith("```")) {
      raw = raw.split("\n").slice(1).join("\n");
      const fence = raw.lastIndexOf("```");
      if (fence !== -1) raw = raw.slice(0, fence).trim();
    }

    const extracted = JSON.parse(raw) as {
      cover_letter: string;
      cv_changes: string[];
      tailored_summary: string;
    };

    // Insert draft Application row, return generated id
    const appRows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO "Application" (id, user_id, job_id, status, tailored_cv, cover_letter, applied_at)
      VALUES (gen_random_uuid(), ${user.id}, ${job_id}, 'draft',
              ${extracted.tailored_summary}, ${extracted.cover_letter}, now())
      RETURNING id
    `;

    return NextResponse.json({
      application_id: appRows[0].id,
      cover_letter: extracted.cover_letter,
      cv_changes: extracted.cv_changes,
      job_title: job.title,
      company: job.company,
    });
  } catch (err) {
    console.error("[apply/prepare]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
