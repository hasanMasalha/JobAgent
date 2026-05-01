import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, LevelFormat, ExternalHyperlink, UnderlineType,
  LineRuleType,
} from 'docx'

interface CVHyperlink {
  text: string
  url: string
  context: string
}

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
  runStyle: { font: string; size: number; color: string; bold?: boolean }
): (TextRun | ExternalHyperlink)[] {
  const matches: LinkMatch[] = []

  for (const link of hyperlinks) {
    for (const term of [link.text, link.url].filter(Boolean)) {
      const idx = lineText.toLowerCase().indexOf(term.toLowerCase())
      if (idx !== -1) {
        matches.push({
          start: idx,
          end: idx + term.length,
          url: link.url,
          displayText: lineText.substring(idx, idx + term.length),
        })
        break
      }
    }
  }

  for (const pattern of LINE_URL_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, 'g')
    let m: RegExpExecArray | null
    while ((m = regex.exec(lineText)) !== null) {
      const url = pattern.buildUrl(m)
      const start = m.index
      const end = start + m[0].length
      if (!matches.some((e) => e.start < end && e.end > start)) {
        matches.push({ start, end, url, displayText: m[0] })
      }
    }
  }

  if (!matches.length) {
    return [new TextRun({ text: lineText, ...runStyle, rightToLeft: false })]
  }

  matches.sort((a, b) => a.start - b.start)

  const runs: (TextRun | ExternalHyperlink)[] = []
  let pos = 0
  for (const match of matches) {
    if (match.start < pos) continue
    if (match.start > pos) {
      runs.push(new TextRun({
        text: lineText.substring(pos, match.start),
        ...runStyle,
        rightToLeft: false,
      }))
    }
    runs.push(new ExternalHyperlink({
      link: match.url,
      children: [new TextRun({
        text: match.displayText,
        font: runStyle.font,
        size: runStyle.size,
        color: '1D4ED8',
        underline: { type: UnderlineType.SINGLE },
        rightToLeft: false,
      })],
    }))
    pos = match.end
  }
  if (pos < lineText.length) {
    runs.push(new TextRun({
      text: lineText.substring(pos),
      ...runStyle,
      rightToLeft: false,
    }))
  }

  return runs
}

// Bold the project/item name before " – " or " - " in bullet lines
function buildBulletRuns(
  text: string,
  hyperlinks: CVHyperlink[],
  runStyle: { font: string; size: number; color: string }
): (TextRun | ExternalHyperlink)[] {
  const dashIdx = text.indexOf(' – ')   // en-dash
  const emDashIdx = text.indexOf(' — ')  // em-dash
  const regularDashIdx = text.indexOf(' - ')

  const splitIndex =
    dashIdx !== -1 ? dashIdx :
    emDashIdx !== -1 ? emDashIdx :
    regularDashIdx !== -1 ? regularDashIdx :
    -1

  if (splitIndex === -1) {
    return linkifyLine(text, hyperlinks, runStyle)
  }

  const separator =
    dashIdx !== -1 ? ' – ' :
    emDashIdx !== -1 ? ' — ' :
    ' - '

  const beforeDash = text.substring(0, splitIndex)
  const afterDash = text.substring(splitIndex + separator.length)

  return [
    new TextRun({
      text: beforeDash,
      font: runStyle.font,
      size: runStyle.size,
      color: runStyle.color,
      bold: true,
      rightToLeft: false,
    }),
    new TextRun({
      text: separator,
      font: runStyle.font,
      size: runStyle.size,
      color: runStyle.color,
      bold: false,
      rightToLeft: false,
    }),
    ...linkifyLine(afterDash, hyperlinks, { ...runStyle, bold: false }),
  ]
}

export async function generateCVDocx(
  cvText: string,
  _jobTitle: string = 'CV',
  hyperlinks: CVHyperlink[] = []
): Promise<Buffer> {

  const FONT = 'Calibri'
  const COLOR_NAME    = '1F2937'   // near black
  const COLOR_SECTION = '2563EB'   // blue for section headers
  const COLOR_BODY    = '374151'   // dark gray
  const COLOR_CONTACT = '6B7280'   // medium gray

  const LINE_SPACING = { line: 220, lineRule: LineRuleType.AUTO }

  const children: Paragraph[] = []

  const lines = cvText.split('\n').map(l => l.trim()).filter(Boolean)

  const SECTION_HEADERS = [
    'summary', 'work experience', 'experience', 'education',
    'skills', 'projects', 'languages', 'certifications',
    'achievements', 'contact', 'hackathon', 'hackathons',
    'volunteer', 'awards', 'publications',
  ]

  const isSectionHeader = (line: string) =>
    SECTION_HEADERS.some(h =>
      line.toLowerCase() === h || line.toLowerCase().startsWith(h + ':')
    )

  const isBullet = (line: string) =>
    line.startsWith('- ') || line.startsWith('• ') ||
    line.startsWith('* ') || line.startsWith('o ')

  const isSubBullet = (line: string) => line.startsWith('o ')

  let isFirstLine = true
  let isSecondLine = false
  let nameAdded = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ── Line 1: candidate name ──────────────────────────────────────────────
    if (isFirstLine) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: false,
        spacing: { before: 0, after: 40, ...LINE_SPACING },
        children: [new TextRun({
          text: line,
          font: FONT,
          size: 28,
          bold: true,
          color: COLOR_NAME,
          rightToLeft: false,
        })],
      }))
      isFirstLine = false
      isSecondLine = true
      nameAdded = true
      continue
    }

    // ── Line 2: contact info ────────────────────────────────────────────────
    if (isSecondLine && nameAdded) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: false,
        spacing: { before: 0, after: 100, ...LINE_SPACING },
        children: linkifyLine(line, hyperlinks, { font: FONT, size: 17, color: COLOR_CONTACT }),
      }))
      isSecondLine = false
      continue
    }

    // ── Section headers ─────────────────────────────────────────────────────
    if (isSectionHeader(line)) {
      children.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        bidirectional: false,
        spacing: { before: 100, after: 50, ...LINE_SPACING },
        border: {
          bottom: {
            color: COLOR_SECTION,
            style: BorderStyle.SINGLE,
            size: 6,
            space: 4,
          },
        },
        children: [new TextRun({
          text: line.toUpperCase(),
          font: FONT,
          size: 20,
          bold: true,
          color: COLOR_SECTION,
          characterSpacing: 40,
          rightToLeft: false,
        })],
      }))
      continue
    }

    // ── Sub-bullets (o prefix) ──────────────────────────────────────────────
    if (isSubBullet(line)) {
      const text = line.replace(/^o\s+/, '')
      children.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        bidirectional: false,
        numbering: { reference: 'cv-sub-bullets', level: 0 },
        spacing: { before: 0, after: 20, ...LINE_SPACING },
        children: buildBulletRuns(text, hyperlinks, { font: FONT, size: 18, color: COLOR_BODY }),
      }))
      continue
    }

    // ── Main bullets ────────────────────────────────────────────────────────
    if (isBullet(line)) {
      const text = line.replace(/^[-•*]\s+/, '')
      children.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        bidirectional: false,
        numbering: { reference: 'cv-main-bullets', level: 0 },
        spacing: { before: 0, after: 20, ...LINE_SPACING },
        children: buildBulletRuns(text, hyperlinks, { font: FONT, size: 18, color: COLOR_BODY }),
      }))
      continue
    }

    // ── Role/date header lines (Title · Company – Date) ─────────────────────
    const isRoleHeader =
      line.includes('·') ||
      (line.includes('–') && !!line.match(/\d{4}/)) ||
      (line.includes('-') && !!line.match(/\d{4}/))

    if (isRoleHeader) {
      const parts = line.split(/[·–]/)
      const runParts = parts.flatMap((part, idx) =>
        [new TextRun({
          text: idx === 0 ? part.trim() : ' · ' + part.trim(),
          font: FONT,
          size: 18,
          bold: idx === 0,
          color: idx === 0 ? COLOR_NAME : COLOR_CONTACT,
          rightToLeft: false,
        })]
      )
      children.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        bidirectional: false,
        spacing: { before: 80, after: 20, ...LINE_SPACING },
        children: runParts,
      }))
      continue
    }

    // ── Regular body text ───────────────────────────────────────────────────
    children.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      bidirectional: false,
      spacing: { before: 0, after: 30, ...LINE_SPACING },
      children: linkifyLine(line, hyperlinks, { font: FONT, size: 18, color: COLOR_BODY }),
    }))
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'cv-main-bullets',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 360, hanging: 180 },
                bidirectional: false,
              },
              run: {
                font: FONT,
                size: 18,
                color: COLOR_BODY,
              },
            },
          }],
        },
        {
          reference: 'cv-sub-bullets',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '○',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 180 },
                bidirectional: false,
              },
              run: {
                font: FONT,
                size: 18,
                color: COLOR_BODY,
              },
            },
          }],
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },  // US Letter
          margin: {
            top: 700,
            bottom: 700,
            left: 900,
            right: 900,
          },
        },
      },
      children,
    }],
  })

  return await Packer.toBuffer(doc)
}
