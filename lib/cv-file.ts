// The CV file a user downloads (or gets attached to an email), from CV text
// we may render — a tailored or generated CV, never the user's own upload.
//
// PDF is the default: it's the file the design holds in exactly (embedded
// Public Sans, tracking, right-aligned dates) and the same renderer as the
// CV that ATS applications submit (ai-service/utils/cv_pdf.py, via
// /render-cv-pdf). Word (.docx) only when asked for (`?format=docx`): it's
// for the employer that demands Word, and Word can only approximate the
// design (lib/generate-cv.ts says how).
import { generateCVDocx } from "@/lib/generate-cv";
import { pythonFetch } from "@/lib/python-service";

export type CvFormat = "pdf" | "docx";

export interface CVHyperlink {
  text: string;
  url: string;
  context: string;
}

export interface CvFile {
  body: Buffer;
  contentType: string;
  extension: CvFormat;
}

export function cvFormat(param: string | null | undefined): CvFormat {
  return param === "docx" ? "docx" : "pdf";
}

// The PDF sets Latin and Hebrew (Public Sans + Noto Sans Hebrew). A CV with
// letters in another script (Arabic, Cyrillic…) gets 422 from the renderer
// rather than a PDF full of boxes, and comes as Word instead: Word picks a
// font that has them. The caller names the file by `extension`.
async function renderDocx(cvText: string, hyperlinks: CVHyperlink[]): Promise<CvFile> {
  return {
    body: await generateCVDocx(cvText, "CV", hyperlinks),
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  };
}

export async function renderCvFile(cvText: string, format: CvFormat, hyperlinks: CVHyperlink[] = []): Promise<CvFile> {
  if (format === "docx") return renderDocx(cvText, hyperlinks);
  const res = await pythonFetch("/render-cv-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cv_text: cvText }),
  });
  if (res.status === 422) {
    const body = await res.json().catch(() => null);
    if (body?.detail === "unsupported_script") return renderDocx(cvText, hyperlinks);
  }
  if (!res.ok) throw new Error(`CV PDF render failed (${res.status})`);
  return { body: Buffer.from(await res.arrayBuffer()), contentType: "application/pdf", extension: "pdf" };
}

// "Jordan Levi" -> "Jordan_Levi" from the CV's first line, else the email's
// local part, else "CV".
export function cvDisplayName(cvText: string, email: string | null | undefined): string {
  const nameFromCv = (cvText.split("\n").find((l) => l.trim()) ?? "").replace(/[^a-zA-Z0-9 ]/g, "").trim();
  const nameFromEmail = (email ?? "").split("@")[0];
  return (nameFromCv || nameFromEmail || "CV").replace(/\s+/g, "_").slice(0, 60);
}
