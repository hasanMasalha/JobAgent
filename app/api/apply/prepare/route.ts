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
    const jobRows = await db.$queryRaw<{ title: string; company: string; description: string; url: string }[]>`
      SELECT title, company, description, url FROM "Job" WHERE id = ${job_id} LIMIT 1
    `;
    if (!jobRows.length) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    const job = jobRows[0];

    // Call Claude Sonnet to tailor CV
    const prompt =
      `Tailor this CV for the role below. Return ONLY valid JSON, no markdown:\n` +
      `{\n` +
      `  "cover_letter": "3 paragraphs, professional tone, specific to this role",\n` +
      `  "cv_changes": ["specific change 1", "specific change 2"],\n` +
      `  "tailored_cv": "The full CV text with all changes applied. Keep the same structure and sections as the original but rewrite/reorder content to best match this role."\n` +
      `}\n\n` +
      `CRITICAL FORMATTING RULES for tailored_cv:\n` +
      `- The tailored CV must fit on exactly ONE page when printed\n` +
      `- Keep the total word count under 400 words\n` +
      `- Each bullet point must be ONE line maximum — no wrapping bullets\n` +
      `- Maximum 3 bullet points per job role\n` +
      `- Professional summary: 2 sentences maximum\n` +
      `- Do not add new sections that weren't in the original CV\n` +
      `- Do not expand content — reword and emphasize, do not add\n\n` +
      `CV:\n${raw_text}\n\n` +
      `Job: ${job.title} at ${job.company}\n` +
      `Description: ${job.description.slice(0, 2000)}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
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
      tailored_cv: string;
    };

    // Reuse existing draft for this user+job if one exists (prevents duplicates on page reload)
    const existing = await db.$queryRaw<{ id: string; cover_letter: string | null; tailored_cv: string | null }[]>`
      SELECT id, cover_letter, tailored_cv FROM "Application"
      WHERE user_id = ${user.id} AND job_id = ${job_id} AND status = 'draft'
      LIMIT 1
    `;
    if (existing.length) {
      // Backfill tailored_cv / cover_letter if missing (e.g. draft created before this feature)
      if (!existing[0].tailored_cv || !existing[0].cover_letter) {
        await db.$executeRaw`
          UPDATE "Application"
          SET tailored_cv   = COALESCE(tailored_cv,   ${extracted.tailored_cv}),
              cover_letter  = COALESCE(cover_letter,  ${extracted.cover_letter})
          WHERE id = ${existing[0].id}
        `;
      }
      return NextResponse.json({
        application_id: existing[0].id,
        cover_letter: existing[0].cover_letter ?? extracted.cover_letter,
        tailored_cv: existing[0].tailored_cv ?? extracted.tailored_cv,
        cv_changes: extracted.cv_changes,
        job_title: job.title,
        company: job.company,
        job_url: job.url,
      });
    }

    // Insert draft Application row, return generated id
    const appRows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO "Application" (id, user_id, job_id, status, tailored_cv, cover_letter, applied_at)
      VALUES (gen_random_uuid(), ${user.id}, ${job_id}, 'draft',
              ${extracted.tailored_cv}, ${extracted.cover_letter}, now())
      RETURNING id
    `;

    return NextResponse.json({
      application_id: appRows[0].id,
      cover_letter: extracted.cover_letter,
      tailored_cv: extracted.tailored_cv,
      cv_changes: extracted.cv_changes,
      job_title: job.title,
      company: job.company,
      job_url: job.url,
    });
  } catch (err) {
    console.error("[apply/prepare]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
