import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  LevelFormat,
  convertInchesToTwip,
} from "docx";

const SECTION_HEADERS = new Set([
  "summary",
  "objective",
  "profile",
  "work experience",
  "experience",
  "employment",
  "education",
  "academic",
  "skills",
  "technical skills",
  "competencies",
  "projects",
  "portfolio",
  "certifications",
  "certificates",
  "awards",
  "languages",
  "publications",
  "references",
]);

function isSectionHeader(line: string): boolean {
  return SECTION_HEADERS.has(line.replace(/:$/, "").toLowerCase().trim());
}

function isBullet(line: string): boolean {
  return /^(o |• |- |· )/.test(line);
}

function stripBullet(line: string): string {
  return line.replace(/^(o |• |- |· )/, "").trim();
}

const SINGLE_SPACING = { line: 240, lineRule: "auto" as const };

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: "Arial", size: 19 })], // 9.5pt
    spacing: { after: 40, ...SINGLE_SPACING },
  });
}

function bulletParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: "Arial", size: 19 })], // 9.5pt
    bullet: { level: 0 },
    spacing: { after: 30, ...SINGLE_SPACING },
  });
}

function sectionHeaderParagraph(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        font: "Arial",
        size: 22, // 11pt
      }),
    ],
    spacing: { before: 120, after: 60, ...SINGLE_SPACING },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999" },
    },
  });
}

function spacerParagraph(): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: "" })],
    spacing: { after: 40, ...SINGLE_SPACING },
  });
}

export async function generateCVDocx(
  cvText: string,
  jobTitle: string
): Promise<Buffer> {
  const lines = cvText.split("\n");
  const children: Paragraph[] = [];

  // First line → candidate name (16pt bold centered)
  // Second line → contact (11pt centered)
  let lineIndex = 0;

  // Skip leading empty lines
  while (lineIndex < lines.length && !lines[lineIndex].trim()) lineIndex++;

  if (lineIndex < lines.length) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: lines[lineIndex].trim(),
            bold: true,
            font: "Arial",
            size: 28, // 14pt
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60, ...SINGLE_SPACING },
      })
    );
    lineIndex++;
  }

  // Second non-empty line → contact info centered
  while (lineIndex < lines.length && !lines[lineIndex].trim()) lineIndex++;

  if (lineIndex < lines.length && !isSectionHeader(lines[lineIndex])) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: lines[lineIndex].trim(),
            font: "Arial",
            size: 22, // 11pt
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 80, ...SINGLE_SPACING },
      })
    );
    lineIndex++;
  }

  // Remaining lines
  for (; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex];
    const line = raw.trim();

    if (!line) {
      children.push(spacerParagraph());
    } else if (isSectionHeader(line)) {
      children.push(sectionHeaderParagraph(line.replace(/:$/, "")));
    } else if (isBullet(line)) {
      children.push(bulletParagraph(stripBullet(line)));
    } else {
      children.push(bodyParagraph(line));
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "bullet-list",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: convertInchesToTwip(0.375),
                    hanging: convertInchesToTwip(0.25),
                  },
                },
                run: { font: "Arial" },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) }, // A4
            margin: {
              top: 900,
              bottom: 900,
              left: 900,
              right: 900,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
