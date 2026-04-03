import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPrompt(data: CVFormData): string {
  const { personal, experiences, educations, skillsInfo } = data;

  const expLines = experiences
    .filter((e) => e.title && e.company)
    .map((e) => {
      const end = e.current ? "Present" : `${e.endMonth} ${e.endYear}`;
      const period = `${e.startMonth} ${e.startYear} – ${end}`;
      return [
        `  Role: ${e.title} at ${e.company}`,
        `  Period: ${period}`,
        e.location ? `  Location: ${e.location}` : "",
        e.description ? `  Description:\n${e.description.split("\n").map((l) => `    ${l}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const eduLines = educations
    .filter((e) => e.institution && e.field)
    .map((e) => {
      return [
        `  ${e.degree} in ${e.field} — ${e.institution} (${e.year})`,
        e.achievement ? `  Achievement: ${e.achievement}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const projectLines = (skillsInfo.projects ?? [])
    .filter((p) => p.name)
    .map(
      (p) =>
        `  ${p.name}${p.tech ? ` (${p.tech})` : ""}${p.description ? `: ${p.description}` : ""}`
    )
    .join("\n");

  return `You are a professional CV writer. Write a polished, ATS-optimised CV in plain text.

Candidate information:
Name: ${personal.fullName}
Target role: ${personal.title}
Email: ${personal.email}
Phone: ${personal.phone}
Location: ${personal.location}
${personal.linkedin ? `LinkedIn: ${personal.linkedin}` : ""}
${personal.portfolio ? `Portfolio/GitHub: ${personal.portfolio}` : ""}

Work Experience:
${expLines || "  (none provided)"}

Education:
${eduLines || "  (none provided)"}

Skills: ${skillsInfo.skills?.join(", ") || "(none)"}
Languages: ${skillsInfo.languages?.join(", ") || "(none)"}

${projectLines ? `Projects:\n${projectLines}` : ""}

Instructions:
- Start with the candidate's full name on the first line, then contact info on the second line (email | phone | location${personal.linkedin ? " | LinkedIn" : ""}${personal.portfolio ? " | Portfolio" : ""})
- Write a 2-3 sentence professional summary tailored to "${personal.title}"
- For each job: write 3-5 impactful bullet points using strong action verbs and quantified achievements where possible
- Use these exact section headers (plain text, no markdown): Summary, Work Experience, Education, Skills, Languages${projectLines ? ", Projects" : ""}
- Bullet points must start with "• "
- Keep the CV to one page (approx 550 words max)
- Do NOT include any markdown, asterisks, or special formatting — plain text only
- Do NOT add any explanatory text, preamble, or notes after the CV`;
}

interface Experience {
  title: string;
  company: string;
  location?: string;
  startMonth: string;
  startYear: string;
  endMonth: string;
  endYear: string;
  current: boolean;
  description: string;
}

interface Education {
  degree: string;
  field: string;
  institution: string;
  year: string;
  achievement?: string;
}

interface Project {
  name: string;
  tech?: string;
  description?: string;
}

interface SkillsInfo {
  skills: string[];
  languages: string[];
  projects: Project[];
}

interface Personal {
  fullName: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  linkedin?: string;
  portfolio?: string;
}

interface CVFormData {
  personal: Personal;
  experiences: Experience[];
  educations: Education[];
  skillsInfo: SkillsInfo;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData: CVFormData = await req.json();

    // Generate CV text with Claude Sonnet
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: buildPrompt(formData) }],
    });

    const cvText =
      message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("") ?? "";

    if (!cvText.trim()) {
      return NextResponse.json({ error: "Claude returned empty CV" }, { status: 500 });
    }

    // Send to Python service for embeddings
    const pythonRes = await fetch(
      `${process.env.PYTHON_SERVICE_URL}/process-cv`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_text: cvText, user_id: user.id }),
        signal: AbortSignal.timeout(120_000),
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

    // Ensure user row exists
    await db.$executeRaw`
      INSERT INTO "User" (id, email, created_at)
      VALUES (${user.id}, ${user.email ?? ""}, now())
      ON CONFLICT (id) DO NOTHING
    `;

    // Upsert CV row
    await db.$executeRaw`
      INSERT INTO "CV" (id, user_id, raw_text, skills_json, clean_summary, embedding, updated_at)
      VALUES (gen_random_uuid(), ${user.id}, ${cvText}, ${JSON.stringify(skills_json)}::jsonb,
              ${clean_summary}, ${JSON.stringify(embedding)}::vector, now())
      ON CONFLICT (user_id) DO UPDATE
        SET raw_text = EXCLUDED.raw_text,
            skills_json = EXCLUDED.skills_json,
            clean_summary = EXCLUDED.clean_summary,
            embedding = EXCLUDED.embedding,
            updated_at = now()
    `;

    // Fetch the cv id
    const cvRow = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "CV" WHERE user_id = ${user.id} LIMIT 1
    `;

    return NextResponse.json({
      cv_text: cvText,
      cv_id: cvRow[0]?.id ?? null,
    });
  } catch (err) {
    console.error("[cv/generate]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
