// jszip ships as a dependency of docx — used here only to read the .docx back.
import JSZip from "jszip";
import { generateCVDocx } from "@/lib/generate-cv";

// Sections deliberately out of order, mirroring ai-service/tests/test_cv_pdf.py.
const SHUFFLED_CV = `Jordan Levi
jordan.levi@example.com | +972 50 123 4567

Technical Skills
Languages: Python, TypeScript, SQL, Go
Infrastructure: AWS, Docker, Kubernetes, Terraform
Data: PostgreSQL, pgvector, Kafka, Redis

Hackathons
- 1st place, TAU Hack 2019

Education
B.Sc. Computer Science, Tel Aviv University | 2016 - 2020
- Graduated with honors

Certifications
- AWS Solutions Architect

Work Experience
Senior Backend Engineer, Acme Analytics | Jan 2023 - Present
- Designed a Kafka-based ingestion pipeline

Professional Summary
Backend engineer with 5 years building data pipelines.

Personal Projects
- jobscout: open-source job scraper
`;

type Para = { text: string; firstRunBold: boolean };

async function docxParagraphs(cvText: string): Promise<Para[]> {
  const zip = await JSZip.loadAsync(await generateCVDocx(cvText));
  const xml = await zip.file("word/document.xml")!.async("string");
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [])
    .map((p) => {
      const text = Array.from(p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g), (m) => m[1]).join("").trim();
      const firstRun = p.match(/<w:r>[\s\S]*?<\/w:r>/)?.[0] ?? "";
      return { text, firstRunBold: firstRun.includes("<w:b/>") };
    })
    .filter((p) => p.text);
}

describe("generateCVDocx", () => {
  it("renders sections in canonical order, content travelling with its heading", async () => {
    const paras = await docxParagraphs(SHUFFLED_CV);
    const texts = paras.map((p) => p.text);
    const headings = texts.filter((t) => /^[A-Z]+$/.test(t));
    expect(headings).toEqual(["SUMMARY", "EXPERIENCE", "PROJECTS", "EDUCATION", "SKILLS", "CERTIFICATIONS", "HACKATHONS"]);
    expect(texts[texts.indexOf("SUMMARY") + 1]).toBe("Backend engineer with 5 years building data pipelines.");
  });

  it("keeps each Skills category on its own line with a bold label", async () => {
    const paras = await docxParagraphs(SHUFFLED_CV);
    for (const label of ["Languages:", "Infrastructure:", "Data:"]) {
      const para = paras.find((p) => p.text.startsWith(label));
      expect(para).toBeDefined();
      expect(para!.firstRunBold).toBe(true);
    }
  });

  it("puts the date inline after the title", async () => {
    const texts = (await docxParagraphs(SHUFFLED_CV)).map((p) => p.text);
    expect(texts).toContain("Senior Backend Engineer, Acme Analytics | Jan 2023 - Present");
    expect(texts).toContain("B.Sc. Computer Science, Tel Aviv University | 2016 - 2020");
  });
});
