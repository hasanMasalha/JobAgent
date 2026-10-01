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
  runStyle: { font: string; size: number; color: string; bold?: boolean }
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
        bold: runStyle.bold,
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

// ── design tokens ────────────────────────────────────────────────────────
// One accent colour (deep navy), used only for the name, section headings
// and the hairline rules under them — everything else stays near-black/grey.
const FONT = 'Calibri'
const ACCENT_NAVY = '1B3A5C'
const COLOR_ROLE = '1F2937'    // role/school titles (bold)
const COLOR_BODY = '374151'    // paragraph and bullet text
const COLOR_MUTED = '6B7280'   // contact line, role dates

// Canonical ATS-safe section names. Anything not in this map keeps its own
// (title-cased) text rather than being forced into one of these — we only
// normalize the headings parsers are told to expect, never invent new ones.
const CANONICAL_SECTIONS: Record<string, string> = {
  'summary': 'Summary', 'professional summary': 'Summary', 'objective': 'Summary', 'profile': 'Summary',
  'work experience': 'Experience', 'experience': 'Experience', 'employment': 'Experience',
  'employment history': 'Experience', 'professional experience': 'Experience',
  'education': 'Education', 'academic background': 'Education',
  'skills': 'Skills', 'technical skills': 'Skills', 'core competencies': 'Skills', 'competencies': 'Skills',
  'projects': 'Projects', 'portfolio': 'Projects', 'personal projects': 'Projects',
  'certifications': 'Certifications', 'certificates': 'Certifications', 'awards': 'Awards',
  'languages': 'Languages', 'publications': 'Publications', 'references': 'References',
}

function sectionKey(line: string): string {
  return line.trim().replace(/:$/, '').toLowerCase()
}

function isSectionHeader(line: string): boolean {
  return sectionKey(line) in CANONICAL_SECTIONS
}

function canonicalSectionText(line: string): string {
  const key = sectionKey(line)
  if (CANONICAL_SECTIONS[key]) return CANONICAL_SECTIONS[key]
  const trimmed = line.trim().replace(/:$/, '')
  return trimmed.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

// A section header we don't recognize by name (e.g. "Hackathons",
// "Volunteering") — not a CANONICAL_SECTIONS keyword, so we keep its own
// wording rather than forcing it into one of the five. Short,
// punctuation/digit-free, title-cased; confirmed by generateCVDocx only
// when the next line is a bullet or role header, so an ordinary short
// sentence never gets mistaken for a heading.
function isBareHeadingCandidate(line: string): boolean {
  const trimmed = line.trim().replace(/:$/, '')
  if (!trimmed || trimmed.length > 30) return false
  if (/[.,;()@|]/.test(trimmed)) return false
  if (/\d/.test(trimmed)) return false
  const words = trimmed.split(/\s+/)
  if (words.length === 0 || words.length > 4) return false
  return words.every((w) => !/[a-zA-Z]/.test(w[0]) || w[0] === w[0].toUpperCase())
}

function isBullet(line: string): boolean {
  return line.startsWith('- ') || line.startsWith('• ') || line.startsWith('* ') || line.startsWith('o ') || line.startsWith('○ ') || line.startsWith('● ')
}

// Trailing date/range detection, e.g. "... Acme Corp - 2021 - Present" or
// "... MIT (2016 - 2020)" — anchored at end-of-line so a stray 4-digit number
// mid-sentence ("2000+ GitHub stars") never gets mistaken for a date.
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?'
const DATE_TOKEN = `(?:${MONTH}\\s+)?\\d{4}`
const DATE_RANGE_RE = new RegExp(`\\(?\\s*(?:${DATE_TOKEN}|Present|Current)\\s*[-–—]\\s*(?:${DATE_TOKEN}|Present|Current|Now)\\s*\\)?\\s*$`, 'i')
const SINGLE_DATE_RE = new RegExp(`\\(?\\s*(?:${DATE_TOKEN})\\s*\\)?\\s*$`)

function splitRoleHeader(line: string): { left: string; date: string } {
  const m = DATE_RANGE_RE.exec(line) ?? SINGLE_DATE_RE.exec(line)
  if (!m || m.index === undefined) return { left: line.trim(), date: '' }
  const date = line.slice(m.index).trim().replace(/^\(|\)\s*$/g, '').trim()
  const left = line.slice(0, m.index).replace(/[\s\-–—|·,]+$/, '').trim()
  return { left: left || line.trim(), date }
}

function isRoleHeader(line: string): boolean {
  if (isBullet(line) || isSectionHeader(line)) return false
  const hasSeparator = ['·', '–', '—', '|'].some((s) => line.includes(s)) || / at /i.test(line)
  const hasTrailingDate = DATE_RANGE_RE.test(line) || SINGLE_DATE_RE.test(line)
  return hasSeparator || hasTrailingDate
}

// Narrow, scoped check used only to decide whether the line immediately
// after the name (when separated by a blank line) is a contact line —
// NOT a general "does this look contact-y" test applied everywhere, which
// previously false-positived on any line with a 3+ digit run (e.g. a role
// header's "2021"), swallowing it before isRoleHeader ever ran.
function looksLikeContactLine(line: string): boolean {
  return line.includes('@') || line.includes('|') || line.includes('+') || /\d{3}/.test(line)
}

// Merge hard line-wraps from the source PDF/DOCX text extraction back into
// logical lines. Extracted text commonly hard-breaks mid-sentence at
// wherever the original document happened to wrap — without this, a
// bullet's wrapped continuation renders as its own orphaned, unindented
// paragraph instead of flowing under the bullet it belongs to. A line
// starts a new logical line if it looks like a bullet/heading/role header,
// or if the previous logical line already looks "closed" (ends in
// sentence-terminal punctuation); otherwise it's appended to the previous
// one. name/contact lines are never a merge source or target.
function reflowLines(rawLines: string[], nameIdx: number | null, contactIdx: number | null): string[] {
  const protectedCount = (nameIdx !== null ? 1 : 0) + (contactIdx !== null ? 1 : 0)
  const result: string[] = []
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim()
    if (!line) continue
    if (i === nameIdx || i === contactIdx) {
      result.push(line)
      continue
    }

    // "Languages: ..." / "Data: ..." category lines rarely end in punctuation,
    // so without the LABEL_RE check each one would be glued onto the previous
    // category and only the first label would render bold.
    const startsNewBlock =
      isBullet(line) || isSectionHeader(line) || isRoleHeader(line) || isBareHeadingCandidate(line) ||
      LABEL_RE.test(line)
    if (!startsNewBlock && result.length > protectedCount) {
      const prev = result[result.length - 1]
      const prevIsOpen = !/[.!?:]\s*$/.test(prev) && !isSectionHeader(prev)
      if (prevIsOpen) {
        result[result.length - 1] = `${prev} ${line}`
        continue
      }
    }
    result.push(line)
  }
  return result
}

// Canonical section order, applied by the renderer rather than trusted to the
// AI's output. Other canonical sections (Certifications, Languages, ...) follow
// Skills; unrecognized headings ("Hackathons") go last. Ties keep input order.
// Mirrors _order_sections in ai-service/utils/cv_pdf.py.
const SECTION_ORDER: Record<string, number> = { Summary: 0, Experience: 1, Projects: 2, Education: 3, Skills: 4 }
const OTHER_CANONICAL_RANK = 5
const NONSTANDARD_RANK = 6

function sectionRank(heading: string): number {
  if (!isSectionHeader(heading)) return NONSTANDARD_RANK
  return SECTION_ORDER[canonicalSectionText(heading)] ?? OTHER_CANONICAL_RANK
}

// Regroup body lines into sections (heading + everything up to the next
// heading) and stable-sort the sections by sectionRank. Lines before the
// first heading stay on top.
function orderSections(lines: string[], headingIdx: Set<number>): { line: string; isHeading: boolean }[] {
  type Item = { line: string; isHeading: boolean }
  const preamble: Item[] = []
  const sections: { rank: number; items: Item[] }[] = []
  lines.forEach((line, i) => {
    if (headingIdx.has(i)) sections.push({ rank: sectionRank(line), items: [{ line, isHeading: true }] })
    else if (sections.length) sections[sections.length - 1].items.push({ line, isHeading: false })
    else preamble.push({ line, isHeading: false })
  })
  sections.sort((a, b) => a.rank - b.rank) // Array.prototype.sort is stable (ES2019+)
  return [...preamble, ...sections.flatMap((s) => s.items)]
}

// "Languages: Python, Go, TypeScript" -> bold "Languages:" label, plain rest.
// Lets "Skills grouped by category" fall out of normal "Label: values" text
// without inventing categories that aren't in the source content.
const LABEL_RE = /^([A-Za-z][A-Za-z0-9 /&+-]{0,30}:)\s*(.+)$/

function labelRuns(
  text: string,
  hyperlinks: CVHyperlink[],
  runStyle: { font: string; size: number; color: string }
): (TextRun | ExternalHyperlink)[] | null {
  const m = LABEL_RE.exec(text)
  if (!m) return null
  const [, label, rest] = m
  return [
    new TextRun({ text: `${label} `, font: runStyle.font, size: runStyle.size, bold: true, color: runStyle.color }),
    ...linkifyLine(rest, hyperlinks, runStyle),
  ]
}

export async function generateCVDocx(
  cvText: string,
  _jobTitle: string = 'CV',
  hyperlinks: CVHyperlink[] = []
): Promise<Buffer> {

  const children: Paragraph[] = []

  const rawLines = cvText.split('\n').map((l) => l.trim())
  const rawNonEmptyIdx: number[] = []
  rawLines.forEach((l, i) => { if (l) rawNonEmptyIdx.push(i) })

  const rawNameIdx = rawNonEmptyIdx.length ? rawNonEmptyIdx[0] : null
  let rawContactIdx: number | null = null
  if (rawNameIdx !== null) {
    const rest = rawNonEmptyIdx.filter((i) => i > rawNameIdx)
    if (rest.length && (rest[0] === rawNameIdx + 1 || looksLikeContactLine(rawLines[rest[0]]))) {
      rawContactIdx = rest[0]
    }
  }

  const lines = reflowLines(rawLines, rawNameIdx, rawContactIdx)
  const nameIdx = lines.length ? 0 : null
  const contactIdx = rawContactIdx !== null && lines.length > 1 ? 1 : null

  // Headings not in CANONICAL_SECTIONS (e.g. "Hackathons") still get the
  // heading treatment if the line looks heading-shaped AND is immediately
  // followed by a bullet or role header — otherwise a short sentence could
  // be mistaken for one.
  const bareHeadingIndices = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    if (i === nameIdx || i === contactIdx) continue
    const line = lines[i]
    if (isSectionHeader(line) || isBullet(line) || !isBareHeadingCandidate(line)) continue
    const next = lines[i + 1]
    if (next !== undefined && (isBullet(next) || isRoleHeader(next))) {
      bareHeadingIndices.add(i)
    }
  }

  // Name/contact stay on top (indices 0/1); body sections go into canonical order.
  const headerCount = (nameIdx !== null ? 1 : 0) + (contactIdx !== null ? 1 : 0)
  const bodyHeadingIdx = new Set<number>()
  for (let i = headerCount; i < lines.length; i++) {
    if (isSectionHeader(lines[i]) || bareHeadingIndices.has(i)) bodyHeadingIdx.add(i - headerCount)
  }
  const ordered = orderSections(lines.slice(headerCount), bodyHeadingIdx)
  const renderLines = [...lines.slice(0, headerCount), ...ordered.map((o) => o.line)]
  const headingIndices = new Set<number>()
  ordered.forEach((o, j) => { if (o.isHeading) headingIndices.add(j + headerCount) })

  for (let i = 0; i < renderLines.length; i++) {
    const line = renderLines[i]

    // First line = candidate name — large, bold, accent colour, centered (never a link)
    if (i === nameIdx) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 40 },
        children: [new TextRun({
          text: line,
          font: FONT,
          size: 40,
          bold: true,
          color: ACCENT_NAVY,
        })]
      }))
      continue
    }

    // Contact line (email, phone, LinkedIn) — pipe-separated, muted grey.
    if (i === contactIdx) {
      const parts = line.split('|').map((p) => p.trim()).filter(Boolean)
      const contactRuns: (TextRun | ExternalHyperlink)[] = []
      parts.forEach((part, idx) => {
        if (idx > 0) contactRuns.push(new TextRun({ text: '  |  ', font: FONT, size: 18, color: COLOR_MUTED }))
        contactRuns.push(...linkifyLine(part, hyperlinks, { font: FONT, size: 18, color: COLOR_MUTED }))
      })
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 200 },
        children: contactRuns.length ? contactRuns : linkifyLine(line, hyperlinks, { font: FONT, size: 18, color: COLOR_MUTED }),
      }))
      continue
    }

    // Section headers — canonical ATS-safe names, accent colour, hairline rule under — never links
    if (headingIndices.has(i)) {
      const headingText = isSectionHeader(line) ? canonicalSectionText(line) : line.replace(/:$/, '')
      children.push(new Paragraph({
        spacing: { before: 220, after: 0 },
        keepNext: true, // never let Word strand a heading alone at the bottom of a page
        border: {
          bottom: {
            color: ACCENT_NAVY,
            style: BorderStyle.SINGLE,
            size: 6,
            space: 4,
          }
        },
        children: [new TextRun({
          text: headingText.toUpperCase(),
          font: FONT,
          size: 21,
          bold: true,
          color: ACCENT_NAVY,
          characterSpacing: 20,
        })]
      }))
      continue
    }

    // Bullet points
    if (isBullet(line)) {
      const text = line.replace(/^[-•*o○●]\s+/, '')
      const labeled = labelRuns(text, hyperlinks, { font: FONT, size: 19, color: COLOR_BODY })
      children.push(new Paragraph({
        numbering: { reference: 'cv-bullets', level: 0 },
        spacing: { before: 0, after: 60 },
        children: labeled ?? linkifyLine(text, hyperlinks, { font: FONT, size: 19, color: COLOR_BODY }),
      }))
      continue
    }

    // Role/entry header — "Title, Company · Dates" — bold title+company, then
    // the date inline in muted grey. Not right-aligned: a wide gap makes text
    // extractors (and so ATS parsers) treat the date as a separate column and
    // attach it to the wrong line.
    if (isRoleHeader(line)) {
      const { left, date } = splitRoleHeader(line)
      const roleRuns: TextRun[] = [new TextRun({ text: left, font: FONT, size: 20, bold: true, color: COLOR_ROLE })]
      if (date) {
        roleRuns.push(new TextRun({ text: ` | ${date}`, font: FONT, size: 19, color: COLOR_MUTED }))
      }
      children.push(new Paragraph({
        spacing: { before: 160, after: 40 },
        children: roleRuns,
      }))
      continue
    }

    // Regular body text — supports "Label: value" bolding (skills grouped by category, etc.)
    const labeled = labelRuns(line, hyperlinks, { font: FONT, size: 19, color: COLOR_BODY })
    children.push(new Paragraph({
      spacing: { before: 0, after: 60 },
      children: labeled ?? linkifyLine(line, hyperlinks, { font: FONT, size: 19, color: COLOR_BODY }),
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
              spacing: { before: 0, after: 60 },
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
