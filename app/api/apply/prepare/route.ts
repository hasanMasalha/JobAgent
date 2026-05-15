import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const anthropic = new Anthropic({ maxRetries: 5, timeout: 120_000 });
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

    // Fetch Job + compute cosine similarity against user's CV embedding
    const jobRows = await db.$queryRaw<{
      title: string;
      company: string;
      description: string;
      url: string;
      match_score: number | null;
    }[]>`
      SELECT j.title, j.company, j.description, j.url,
             CASE WHEN c.embedding IS NOT NULL AND j.embedding IS NOT NULL
                  THEN CAST(1 - (c.embedding <=> j.embedding) AS FLOAT)
                  ELSE NULL END AS match_score
      FROM "Job" j
      LEFT JOIN "CV" c ON c.user_id = ${user.id}
      WHERE j.id = ${job_id}
      LIMIT 1
    `;
    if (!jobRows.length) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    const job = jobRows[0];
    const matchScore: number | null = job.match_score;

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
      `CRITICAL RULES FOR TAILORING:\n` +
      `- Only emphasize skills and experience the candidate ACTUALLY HAS — never fabricate or exaggerate\n` +
      `- Do not reframe the candidate's identity — if they are a software engineer, keep them as a software engineer\n` +
      `- Only highlight genuinely relevant experience for this role\n` +
      `- If the candidate's background does not match the role requirements at all, write an honest cover letter noting transferable skills rather than misrepresenting experience\n` +
      `- Never change job titles or invent experience that does not exist in the original CV\n` +
      `- Maximum change allowed: reorder sections, emphasize relevant existing skills, improve bullet point wording\n` +
      `- The candidate's core identity and actual experience must remain truthful and accurate\n\n` +
      `CV:\n${raw_text}\n\n` +
      `Job: ${job.title} at ${job.company}\n` +
      `Description: ${job.description.slice(0, 2000)}`;

    let message;
    try {
      message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 529 || status === 503 || status === 500) {
        // Sonnet overloaded — fall back to Haiku
        message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        });
      } else {
        throw err;
      }
    }

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
        match_score: matchScore,
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
      match_score: matchScore,
    });
  } catch (err) {
    console.error("[apply/prepare]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
