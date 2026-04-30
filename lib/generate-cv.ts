import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, LevelFormat, ExternalHyperlink, UnderlineType,
} from 'docx'

interface CVHyperlink {
  text: string
  url: string
  context: string
}

// URL patterns used as fallback detection directly on line text
const LINE_URL_PATTERNS: { regex: RegExp; buildUrl: (m: RegExpExecArray) => string }[] = [
  {
    regex: /github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/g,
    buildUrl: (m) => `https://github.com/${m[1]}/${m[2]}`,
  },
  {
    regex: /github\.com\/([a-zA-Z0-9_-]+)/g,
    buildUrl: (m) => `https://github.com/${m[1]}`,
  },
  {
    regex: /linkedin\.com\/in\/([a-zA-Z0-9_-]+)/g,
    buildUrl: (m) => `https://linkedin.com/in/${m[1]}`,
  },
  {
    regex: /https?:\/\/[^\s,;)>\]'"]+/g,
    buildUrl: (m) => m[0],
  },
]

interface LinkMatch {
  start: number
  end: number
  url: string
  displayText: string
}

function linkifyLine(
  lineText: string,
  hyperlinks: CVHyperlink[],
  runStyle: { font: string; size: number; color: string }
): (TextRun | ExternalHyperlink)[] {
  const matches: LinkMatch[] = []

  // Find positions of stored hyperlinks in this line
  for (const link of hyperlinks) {
    // Try display text first, then raw URL
    for (const term of [link.text, link.url].filter(Boolean)) {
      const idx = lineText.toLowerCase().indexOf(term.toLowerCase())
      if (idx !== -1) {
        matches.push({ start: idx, end: idx + term.length, url: link.url, displayText: lineText.substring(idx, idx + term.length) })
        break
      }
    }
  }

  // Find positions of pattern-detected URLs (fallback for plain-text URLs)
  for (const pattern of LINE_URL_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, 'g')
    let m: RegExpExecArray | null
    while ((m = regex.exec(lineText)) !== null) {
      const url = pattern.buildUrl(m)
      const start = m.index
      const end = start + m[0].length
      // Skip if this range overlaps an already-found match
      if (!matches.some((e) => e.start < end && e.end > start)) {
        matches.push({ start, end, url, displayText: m[0] })
      }
    }
  }

  if (!matches.length) {
    return [new TextRun({ text: lineText, ...runStyle })]
  }

  // Process in line order so multiple links per line all get rendered
  matches.sort((a, b) => a.start - b.start)

  const runs: (TextRun | ExternalHyperlink)[] = []
  let pos = 0
  for (const match of matches) {
    if (match.start < pos) continue  // overlapping, already consumed
    if (match.start > pos) {
      runs.push(new TextRun({ text: lineText.substring(pos, match.start), ...runStyle }))
    }
    runs.push(new ExternalHyperlink({
      link: match.url,
      children: [new TextRun({
        text: match.displayText,
        font: runStyle.font,
        size: runStyle.size,
        color: '1D4ED8',
        underline: { type: UnderlineType.SINGLE },
      })],
    }))
    pos = match.end
  }
  if (pos < lineText.length) {
    runs.push(new TextRun({ text: lineText.substring(pos), ...runStyle }))
  }

  return runs
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
