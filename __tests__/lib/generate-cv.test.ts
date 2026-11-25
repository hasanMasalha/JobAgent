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

type Para = { text: string; firstRunBold: boolean; xml: string };

async function readDocx(cvText: string) {
  return JSZip.loadAsync(await generateCVDocx(cvText));
}

async function docxParagraphs(cvText: string): Promise<Para[]> {
  const zip = await readDocx(cvText);
  const xml = await zip.file("word/document.xml")!.async("string");
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [])
    .map((p) => {
      // A right tab between title and date reads as "\t", as a parser sees it.
      const text = Array.from(p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>/g), (m) => m[1] ?? "\t").join("").trim();
      const firstRun = p.match(/<w:r>[\s\S]*?<\/w:r>/)?.[0] ?? "";
      return { text, firstRunBold: firstRun.includes("<w:b/>"), xml: p };
    })
    .filter((p) => p.text);
}

describe("generateCVDocx", () => {
  it("renders sections in canonical order, content travelling with its heading", async () => {
    const paras = await docxParagraphs(SHUFFLED_CV);
    const texts = paras.map((p) => p.text);
    const headings = texts.filter((t) => /^[A-Z]+$/.test(t));
    expect(headings).toEqual(["SUMMARY", "EXPERIENCE", "EDUCATION", "SKILLS", "PROJECTS", "CERTIFICATIONS", "HACKATHONS"]);
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

  it("puts the date on the title's line, after a right tab", async () => {
    const paras = await docxParagraphs(SHUFFLED_CV);
    const texts = paras.map((p) => p.text);
    expect(texts).toContain("Senior Backend Engineer, Acme Analytics\tJan 2023 - Present");
    expect(texts).toContain("B.Sc. Computer Science, Tel Aviv University\t2016 - 2020");
    const title = paras.find((p) => p.text.startsWith("Senior Backend Engineer"))!;
    expect(title.xml).toMatch(/<w:tab w:val="right"/);
  });

  it("shows the role line only when the CV has one", async () => {
    const withRole = await docxParagraphs("Dana Cohen\nProduct Designer\ndana@example.com | +44 20 7946 0958\n\nSummary\nDesigner.\n");
    expect(withRole.slice(0, 2).map((p) => p.text)).toEqual(["Dana Cohen", "Product Designer"]);
    const without = await docxParagraphs("Dana Cohen\ndana@example.com | +44 20 7946 0958\n\nSummary\nDesigner.\n");
    expect(without[1].text).toContain("dana@example.com");
  });

  it("doesn't take a summary with a dash for a job title", async () => {
    const paras = await docxParagraphs(
      "Dana Cohen\ndana@example.com\n\nSummary\nDesigner with 8 years of systems work — and the patience for it.\n",
    );
    const summary = paras.find((p) => p.text.startsWith("Designer with"))!;
    expect(summary.firstRunBold).toBe(false);
  });

  it("lays every paragraph out left to right", async () => {
    const paras = await docxParagraphs(SHUFFLED_CV);
    for (const p of paras) expect(p.xml).toContain('<w:bidi w:val="false"/>');
  });

  it("embeds Public Sans regular and bold as one family, in part names Word accepts", async () => {
    const zip = await readDocx(SHUFFLED_CV);
    const fontTable = await zip.file("word/fontTable.xml")!.async("string");
    const fonts = fontTable.match(/<w:font w:name="[^"]+">[\s\S]*?<\/w:font>/g) ?? [];
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatch(/w:name="Public Sans"/);
    expect(fonts[0]).toMatch(/<w:altName w:val="Arial"\/>/);
    expect(fonts[0]).toMatch(/<w:embedRegular /);
    expect(fonts[0]).toMatch(/<w:embedBold /);
    // A space in a part name makes Word refuse the whole file as corrupt.
    const parts = Object.keys(zip.files).filter((n) => n.startsWith("word/fonts/") && n.endsWith(".odttf"));
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part).not.toMatch(/\s/);
    const rels = await zip.file("word/_rels/fontTable.xml.rels")!.async("string");
    expect(rels).not.toMatch(/Target="[^"]*\s[^"]*"/);
  });
});
