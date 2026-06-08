import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

// Allow up to 60 seconds for the synchronous part + background call
export const maxDuration = 60;

const URL_PATTERNS = [
  {
    regex: /github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/g,
    buildUrl: (m: RegExpExecArray) => `https://github.com/${m[1]}/${m[2]}`,
    buildText: (m: RegExpExecArray) => `github.com/${m[1]}/${m[2]}`,
  },
  {
    regex: /github\.com\/([a-zA-Z0-9_-]+)(?!\/[a-zA-Z0-9])/g,
    buildUrl: (m: RegExpExecArray) => `https://github.com/${m[1]}`,
    buildText: (m: RegExpExecArray) => `github.com/${m[1]}`,
  },
  {
    regex: /linkedin\.com\/in\/([a-zA-Z0-9_-]+)/g,
    buildUrl: (m: RegExpExecArray) => `https://linkedin.com/in/${m[1]}`,
    buildText: (m: RegExpExecArray) => `linkedin.com/in/${m[1]}`,
  },
  {
    regex: /https?:\/\/(?!linkedin|github)[^\s,;)>\]'"]+/g,
    buildUrl: (m: RegExpExecArray) => m[0],
    buildText: (m: RegExpExecArray) => m[0],
  },
];

function scanTextForUrls(
  text: string,
  allLinks: { text: string; url: string; context: string }[]
) {
  for (const pattern of URL_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, "g");
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const url = pattern.buildUrl(m);
      const txt = pattern.buildText(m);
      if (!allLinks.some((l) => l.url === url)) {
        allLinks.push({ text: txt, url, context: "inline" });
      }
    }
  }
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

    const form = await req.formData();
    const cvFile = form.get("cv") as File | null;
    const titlesRaw = form.get("titles") as string;
    const location = (form.get("location") as string) ?? "";
    const remoteOk = form.get("remote_ok") === "true";
    const minSalaryRaw = form.get("min_salary") as string;
    const workModesRaw = form.get("work_modes") as string;

    if (!cvFile) {
      return NextResponse.json({ error: "No CV file provided" }, { status: 400 });
    }

    const fileName = cvFile.name.toLowerCase();
    const isPdf = fileName.endsWith(".pdf");
    const isDocx = fileName.endsWith(".docx");
    const isDoc = fileName.endsWith(".doc");

    if (!isPdf && !isDocx && !isDoc) {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload a PDF or Word document (.pdf, .docx)." },
        { status: 400 }
      );
    }
    if (isDoc) {
      return NextResponse.json(
        { error: "Old .doc format is not supported. Please save your CV as .docx or .pdf and re-upload." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await cvFile.arrayBuffer());
    let rawText: string;
    const allLinks: { text: string; url: string; context: string }[] = [];

    if (isPdf) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse");
      const result = await pdfParse(buffer);
      rawText = result.text;
      scanTextForUrls(rawText, allLinks);
    } else {
      // .docx
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require("mammoth");
      const [htmlResult, rawResult] = await Promise.all([
        mammoth.convertToHtml({ buffer }),
        mammoth.extractRawText({ buffer }),
      ]);
      rawText = rawResult.value;

      const linkRegex = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      const html: string = htmlResult.value;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(html)) !== null) {
        const url = match[1];
        const text = match[2].replace(/<[^>]+>/g, "").trim();
        if (url.startsWith("mailto:")) continue;
        if (!text && !url) continue;
        const before = html.substring(Math.max(0, match.index - 200), match.index).toLowerCase();
        const context =
          before.includes("project") ? "project" :
          before.includes("experience") ? "experience" :
          before.includes("education") ? "education" :
          "contact";
        if (!allLinks.some((l) => l.url === url)) {
          allLinks.push({ text: text || url, url, context });
        }
      }
      scanTextForUrls(rawText, allLinks);
    }

    // ── Step 1: Persist user row + CV raw text + preferences immediately ──
    // This is fast — no AI calls. Returns to the user in < 2 seconds.

    await db.$executeRaw`
      INSERT INTO "User" (id, email, created_at)
      VALUES (${user.id}, ${user.email ?? ""}, now())
      ON CONFLICT (id) DO NOTHING
    `;

    const hyperlinksJson = JSON.stringify(allLinks);
    await db.$executeRaw`
      INSERT INTO "CV" (id, user_id, raw_text, hyperlinks_json, updated_at)
      VALUES (gen_random_uuid(), ${user.id}, ${rawText}, ${hyperlinksJson}, now())
      ON CONFLICT (user_id) DO UPDATE
        SET raw_text      = EXCLUDED.raw_text,
            hyperlinks_json = EXCLUDED.hyperlinks_json,
            updated_at    = now()
    `;

    const titles: string[] = JSON.parse(titlesRaw ?? "[]");
    const workModes: string[] = workModesRaw ? JSON.parse(workModesRaw) : ["Hybrid"];
    const minSalary = minSalaryRaw ? parseInt(minSalaryRaw) : null;

    await db.$executeRaw`
      INSERT INTO "JobPreference" (id, user_id, titles, locations, remote_ok, work_modes, min_salary, updated_at)
      VALUES (gen_random_uuid(), ${user.id}, ${titles}::text[], ARRAY[${location}]::text[],
              ${remoteOk}, ${workModes}::text[], ${minSalary}, now())
      ON CONFLICT (user_id) DO UPDATE
        SET titles     = EXCLUDED.titles,
            locations  = EXCLUDED.locations,
            remote_ok  = EXCLUDED.remote_ok,
            work_modes = EXCLUDED.work_modes,
            min_salary = EXCLUDED.min_salary,
            updated_at = now()
    `;

    // ── Step 2: Process CV embedding in the background (fire and forget) ──
    // The Node.js runtime continues executing after the response is sent.
    // Skills/embedding are written to the CV row once Python finishes.
    const capturedUserId = user.id;
    const pythonUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
    void (async () => {
      try {
        console.log("[cv/upload] background embedding starting for", capturedUserId);
        const pythonRes = await fetch(`${pythonUrl}/process-cv`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw_text: rawText, user_id: capturedUserId }),
          signal: AbortSignal.timeout(55_000),
        });
        if (!pythonRes.ok) {
          const errText = await pythonRes.text();
          console.error("[cv/upload] Python service error:", errText.substring(0, 200));
          return;
        }
        const { skills_json, clean_summary, embedding } = await pythonRes.json();
        await db.$executeRaw`
          UPDATE "CV"
          SET skills_json   = ${JSON.stringify(skills_json)}::jsonb,
              clean_summary = ${clean_summary},
              embedding     = ${JSON.stringify(embedding)}::vector,
              updated_at    = now()
          WHERE user_id = ${capturedUserId}
        `;
        console.log("[cv/upload] background embedding complete for", capturedUserId);
      } catch (err) {
        console.error("[cv/upload] background embedding failed:", err);
      }
    })();

    return NextResponse.json({ success: true, processing: true });
  } catch (err) {
    console.error("[cv/upload]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
