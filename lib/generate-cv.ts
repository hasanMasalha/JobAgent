import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, LevelFormat, ExternalHyperlink, UnderlineType,
} from 'docx'

interface CVHyperlink {
  text: string
  url: string
  context: string
}

// URL patterns used as a fallback when stored hyperlinks don't cover a line
const LINE_URL_PATTERNS: { regex: RegExp; buildUrl: (m: RegExpMatchArray) => string }[] = [
  {
    regex: /github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/,
    buildUrl: (m) => `https://github.com/${m[1]}/${m[2]}`,
  },
  {
    regex: /github\.com\/([a-zA-Z0-9_-]+)/,
    buildUrl: (m) => `https://github.com/${m[1]}`,
  },
  {
    regex: /linkedin\.com\/in\/([a-zA-Z0-9_-]+)/,
    buildUrl: (m) => `https://linkedin.com/in/${m[1]}`,
  },
  {
    regex: /https?:\/\/[^\s,;)>\]'"]+/,
    buildUrl: (m) => m[0],
  },
]

function linkifyLine(
  lineText: string,
  hyperlinks: CVHyperlink[],
  runStyle: { font: string; size: number; color: string }
): (TextRun | ExternalHyperlink)[] {
  // Build combined link list: stored links + pattern-detected ones from this line
  const allLinks: CVHyperlink[] = [...hyperlinks]
  for (const pattern of LINE_URL_PATTERNS) {
    const m = lineText.match(pattern.regex)
    if (m) {
      const url = pattern.buildUrl(m)
      if (!allLinks.some((l) => l.url === url)) {
        allLinks.push({ text: m[0], url, context: 'inline' })
      }
    }
  }

  if (!allLinks.length) {
    return [new TextRun({ text: lineText, ...runStyle })]
  }

  const runs: (TextRun | ExternalHyperlink)[] = []
  let remaining = lineText

  for (const link of allLinks) {
    // Try matching by anchor text first, then by raw URL
    const searchTerms = [link.text, link.url].filter(Boolean)
    let found = false

    for (const term of searchTerms) {
      const idx = remaining.toLowerCase().indexOf(term.toLowerCase())
      if (idx === -1) continue

      if (idx > 0) {
        runs.push(new TextRun({ text: remaining.substring(0, idx), ...runStyle }))
      }
      runs.push(new ExternalHyperlink({
        link: link.url,
        children: [new TextRun({
          text: remaining.substring(idx, idx + term.length),
          font: runStyle.font,
          size: runStyle.size,
          color: '1D4ED8',
          underline: { type: UnderlineType.SINGLE },
        })],
      }))
      remaining = remaining.substring(idx + term.length)
      found = true
      break
    }

    if (!found) continue
  }

  if (remaining) {
    runs.push(new TextRun({ text: remaining, ...runStyle }))
  }

  return runs.length > 0 ? runs : [new TextRun({ text: lineText, ...runStyle })]
}

export async function generateCVDocx(
  cvText: string,
  _jobTitle: string = 'CV',
  hyperlinks: CVHyperlink[] = []
): Promise<Buffer> {

  const FONT = 'Calibri'
  const COLOR_NAME = '1F2937'      // near black
  const COLOR_SECTION = '1F2937'   // near black for section headers
  const COLOR_BODY = '374151'      // dark gray for body text
  const COLOR_CONTACT = '6B7280'   // medium gray for contact line

  const children: Paragraph[] = []

  const lines = cvText.split('\n').map(l => l.trim()).filter(Boolean)

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

    // First line = candidate name — large, bold, centered (never a link)
    if (isFirstLine) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 40 },
        children: [new TextRun({
          text: line,
          font: FONT,
          size: 32,
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
        children: linkifyLine(line, hyperlinks, { font: FONT, size: 18, color: COLOR_CONTACT }),
      }))
      isSecondLine = false
      continue
    }

    // Section headers — never links
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
          size: 20,
          bold: true,
          color: COLOR_SECTION,
          characterSpacing: 40,
        })]
      }))
      continue
    }

    // Bullet points
    if (isBullet(line)) {
      const text = line.replace(/^[-•*o]\s+/, '')
      children.push(new Paragraph({
        numbering: { reference: 'cv-bullets', level: 0 },
        spacing: { before: 0, after: 40 },
        children: linkifyLine(text, hyperlinks, { font: FONT, size: 19, color: COLOR_BODY }),
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
      children: linkifyLine(line, hyperlinks, { font: FONT, size: 19, color: COLOR_BODY }),
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
