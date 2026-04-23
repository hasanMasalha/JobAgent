import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, LevelFormat,
} from 'docx'

export async function generateCVDocx(
  cvText: string,
  _jobTitle: string = 'CV'
): Promise<Buffer> {

  const FONT = 'Calibri'
  const COLOR_NAME = '1F2937'      // near black
  const COLOR_SECTION = '1F2937'   // near black for section headers
  const COLOR_BODY = '374151'      // dark gray for body text
  const COLOR_CONTACT = '6B7280'   // medium gray for contact line

  const children: Paragraph[] = []

  // Parse the CV text into structured sections
  const lines = cvText.split('\n').map(l => l.trim()).filter(Boolean)

  // Known section headers to detect
  const SECTION_HEADERS = [
    'summary', 'work experience', 'experience', 'education',
    'skills', 'projects', 'languages', 'certifications',
    'achievements', 'contact'
  ]

  const isSectionHeader = (line: string) =>
    SECTION_HEADERS.some(h => line.toLowerCase() === h ||
      line.toLowerCase().startsWith(h + ':'))

  const isBullet = (line: string) =>
    line.startsWith('- ') || line.startsWith('• ') ||
    line.startsWith('* ') || line.startsWith('o ')

  const isContactLine = (line: string) =>
    line.includes('@') || line.includes('|') ||
    line.includes('+') || !!line.match(/\d{3}/)

  let isFirstLine = true
  let isSecondLine = false
  let nameAdded = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // First line = candidate name — large, bold, centered
    if (isFirstLine) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 40 },
        children: [new TextRun({
          text: line,
          font: FONT,
          size: 32,        // 16pt
          bold: true,
          color: COLOR_NAME,
        })]
      }))
      isFirstLine = false
      isSecondLine = true
      nameAdded = true
      continue
    }

    // Contact line (email, phone, LinkedIn)
    if (isSecondLine || (nameAdded && isContactLine(line))) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 120 },
        children: [new TextRun({
          text: line,
          font: FONT,
          size: 18,        // 9pt
          color: COLOR_CONTACT,
        })]
      }))
      isSecondLine = false
      continue
    }

    // Section headers — blue, bold, with bottom border line
    if (isSectionHeader(line)) {
      children.push(new Paragraph({
        spacing: { before: 160, after: 0 },
        border: {
          bottom: {
            color: COLOR_SECTION,
            style: BorderStyle.SINGLE,
            size: 6,
            space: 4,
          }
        },
        children: [new TextRun({
          text: line.toUpperCase(),
          font: FONT,
          size: 20,        // 10pt
          bold: true,
          color: COLOR_SECTION,
          characterSpacing: 40,  // slight letter spacing
        })]
      }))
      continue
    }

    // Bullet points — proper docx bullets, not unicode
    if (isBullet(line)) {
      const text = line.replace(/^[-•*o]\s+/, '')
      children.push(new Paragraph({
        numbering: { reference: 'cv-bullets', level: 0 },
        spacing: { before: 0, after: 40 },
        children: [new TextRun({
          text,
          font: FONT,
          size: 19,        // 9.5pt
          color: COLOR_BODY,
        })]
      }))
      continue
    }

    // Job title lines — detect by pattern (Title, Company · Date)
    const isRoleHeader = line.includes('·') || line.includes('–') ||
      (line.includes('-') && !!line.match(/\d{4}/))

    if (isRoleHeader) {
      const parts = line.split(/[·–]/)
      const runParts = parts.flatMap((part, idx) => [
        new TextRun({
          text: idx === 0 ? part.trim() : ' · ' + part.trim(),
          font: FONT,
          size: 19,
          bold: idx === 0,
          color: idx === 0 ? COLOR_NAME : COLOR_CONTACT,
        })
      ])
      children.push(new Paragraph({
        spacing: { before: 100, after: 20 },
        children: runParts,
      }))
      continue
    }

    // Regular body text
    children.push(new Paragraph({
      spacing: { before: 0, after: 40 },
      children: [new TextRun({
        text: line,
        font: FONT,
        size: 19,          // 9.5pt
        color: COLOR_BODY,
      })]
    }))
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'cv-bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: {
              indent: { left: 360, hanging: 180 },
              spacing: { before: 0, after: 40 },
            },
            run: {
              font: FONT,
              size: 19,
              color: COLOR_BODY,
            }
          }
        }]
      }]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },  // US Letter
          margin: {
            top: 900,
            bottom: 900,
            left: 1080,
            right: 1080,
          }
        }
      },
      children,
    }]
  })

  return await Packer.toBuffer(doc)
}
