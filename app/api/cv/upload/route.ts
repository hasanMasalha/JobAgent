import { NextRequest, NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse");
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const cvFile = form.get("cv") as File | null;
    const titlesRaw = form.get("titles") as string;
    const location = (form.get("location") as string) ?? "";
    const remoteOk = form.get("remote_ok") === "true";
    const minSalaryRaw = form.get("min_salary") as string;

    if (!cvFile) {
      return NextResponse.json({ error: "No CV file provided" }, { status: 400 });
    }

    // Extract text from PDF
    const buffer = Buffer.from(await cvFile.arrayBuffer());
    const { text: rawText } = await pdfParse(buffer);

    // Send to Python service for Claude extraction + embedding
    const pythonRes = await fetch(
      `${process.env.PYTHON_SERVICE_URL}/process-cv`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_text: rawText, user_id: user.id }),
        signal: AbortSignal.timeout(120_000), // 2 min — model loads on first call
      }
    );

    if (!pythonRes.ok) {
      const err = await pythonRes.text();
      return NextResponse.json(
        { error: `AI service error: ${err}` },
        { status: 500 }
      );
    }

    const { skills_json, clean_summary, embedding } = await pythonRes.json();

    // Ensure user row exists in public.User (Supabase Auth only creates auth.users)
    await db.$executeRaw`
      INSERT INTO "User" (id, email, created_at)
      VALUES (${user.id}, ${user.email ?? ""}, now())
      ON CONFLICT (id) DO NOTHING
    `;

    // Upsert CV row (one CV per user)
    await db.$executeRaw`
      INSERT INTO "CV" (id, user_id, raw_text, skills_json, clean_summary, embedding, updated_at)
      VALUES (gen_random_uuid(), ${user.id}, ${rawText}, ${JSON.stringify(skills_json)}::jsonb,
              ${clean_summary}, ${JSON.stringify(embedding)}::vector, now())
      ON CONFLICT (user_id) DO UPDATE
        SET raw_text = EXCLUDED.raw_text,
            skills_json = EXCLUDED.skills_json,
            clean_summary = EXCLUDED.clean_summary,
            embedding = EXCLUDED.embedding,
            updated_at = now()
    `;

    // Save job preferences
    const titles: string[] = JSON.parse(titlesRaw ?? "[]");
    const minSalary = minSalaryRaw ? parseInt(minSalaryRaw) : null;

    await db.$executeRaw`
      INSERT INTO "JobPreference" (id, user_id, titles, locations, remote_ok, min_salary, updated_at)
      VALUES (gen_random_uuid(), ${user.id}, ${titles}::text[], ARRAY[${location}]::text[],
              ${remoteOk}, ${minSalary}, now())
      ON CONFLICT (user_id) DO UPDATE
        SET titles = EXCLUDED.titles,
            locations = EXCLUDED.locations,
            remote_ok = EXCLUDED.remote_ok,
            min_salary = EXCLUDED.min_salary,
            updated_at = now()
    `;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[cv/upload]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
