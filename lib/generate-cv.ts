import { readFile } from 'fs/promises'
import path from 'path'
import JSZip from 'jszip'
import {
  Document, Packer, Paragraph, TextRun, BorderStyle, ExternalHyperlink,
  LineRuleType, Tab, TabStopType, type IParagraphOptions,
} from 'docx'
import { LABEL_RE, keepWithNextFlags, parseCv, type CvLine } from '@/lib/cv-text'

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

// ── design ───────────────────────────────────────────────────────────────
// The same rules as the PDF (ai-service/utils/cv_pdf.py), as far as Word
// can follow them. The PDF is the default download and what ATSs get; this
// is the "employer wants Word" file. Differences, all forced by Word:
// - Public Sans 400 and 700 only, embedded as one family (Word models a
//   family as regular + bold; Medium/SemiBold would be separate families
//   that fall back to *regular* Arial). 500 -> 400, 600 -> 700.
// - Where the embedded font isn't used (Pages, some previewers), Word
//   substitutes Arial / Arial Bold (altName + family "swiss"), so the
//   hierarchy holds. Hebrew goes through the complex-script slot: Arial.
// - Letter-spacing is Word's own (w:spacing): it survives in Word, but a
//   PDF printed from Word extracts the 0.18em labels as "S U M M A R Y" —
//   the PDF renderer avoids that with a pre-tracked font.
// - Pagination happens on the reader's machine; keep-with-next only.
const FONT = 'Public Sans'
const RUN_FONT = { ascii: FONT, hAnsi: FONT, eastAsia: FONT, cs: 'Arial' }
const FONT_DIR = path.join(process.cwd(), 'public', 'fonts', 'cv')

const INK = '15181D'          // body text, names, job titles
const BULLET_INK = '22262C'   // bullet text
const CONTACT = '4B5159'      // contact line
const MUTED = '6B727B'        // dates, secondary lines
const ACCENT = '2C5F7C'       // ONLY the role line under the name and section labels

// Units: sizes in half-points, spacing/indents in twips (1/20 pt).
const pt = (n: number) => Math.round(n * 20)
const half = (n: number) => Math.round(n * 2)
const tracking = (em: number, sizePt: number) => pt(em * sizePt)

const PAGE = { width: 11906, height: 16838 } // A4, as the PDF
const MARGIN = { top: pt(60), right: pt(66), bottom: pt(54), left: pt(66) }
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right
const BODY_LEADING = 1.52

const SPACING = {
  section: pt(26),     // between sections
  role: pt(17),        // between roles in a section
  labelAfter: pt(9),   // section label -> its first line
  ruleBefore: 14,      // contact line -> header rule (border space, in points)
  ruleAfter: pt(26),   // header rule -> first section label
}

type RunStyle = { size: number; color: string; bold?: boolean }

const BODY: RunStyle = { size: half(10), color: INK }
const BULLET: RunStyle = { size: half(10), color: BULLET_INK }
const SUMMARY: RunStyle = { size: half(10.5), color: INK }
const SECONDARY: RunStyle = { size: half(9.5), color: MUTED }
const CONTACT_STYLE: RunStyle = { size: half(9), color: CONTACT }

const exactLine = (sizePt: number, factor = BODY_LEADING) => ({ line: pt(sizePt * factor), lineRule: LineRuleType.EXACT })

// Every paragraph says left-to-right. With no direction on the paragraph,
// Word with a Hebrew (or Arabic) UI lays it out right to left and
// right-aligned — the old Calibri file did; a direction in the document
// defaults alone isn't enough (checked in Word 365, Hebrew UI, 2026-10-14).
function para(options: IParagraphOptions): Paragraph {
  return new Paragraph({ bidirectional: false, ...options })
}

function run(text: string, style: RunStyle, extra: { characterSpacing?: number } = {}): TextRun {
  return new TextRun({ text, font: RUN_FONT, size: style.size, color: style.color, bold: style.bold, ...extra })
}

function linkifyLine(
  lineText: string,
  hyperlinks: CVHyperlink[],
  runStyle: RunStyle
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
    return [run(lineText, runStyle)]
  }

  // Process in line order so multiple links per line all get rendered
  matches.sort((a, b) => a.start - b.start)

  const runs: (TextRun | ExternalHyperlink)[] = []
  let pos = 0
  for (const match of matches) {
    if (match.start < pos) continue  // overlapping, already consumed
    if (match.start > pos) {
      runs.push(run(lineText.substring(pos, match.start), runStyle))
    }
    // Clickable, but in the surrounding text's colour with no underline —
    // the accent is reserved for the role line and section labels.
    runs.push(new ExternalHyperlink({ link: match.url, children: [run(match.displayText, runStyle)] }))
    pos = match.end
  }
  if (pos < lineText.length) {
    runs.push(run(lineText.substring(pos), runStyle))
  }

  return runs
}

// "Languages: Python, Go" -> bold "Languages:" label, plain rest.
function labelOrLinkRuns(text: string, hyperlinks: CVHyperlink[], runStyle: RunStyle): (TextRun | ExternalHyperlink)[] {
  const m = LABEL_RE.exec(text)
  if (!m) return linkifyLine(text, hyperlinks, runStyle)
  const [, label, rest] = m
  return [run(`${label} `, { size: runStyle.size, color: INK, bold: true }), ...linkifyLine(rest, hyperlinks, runStyle)]
}

function lineParagraph(line: CvLine, hyperlinks: CVHyperlink[], keepNext: boolean): Paragraph {
  switch (line.kind) {
    case 'bullet':
      return para({
        indent: { left: pt(16), hanging: pt(6) },
        spacing: { before: 0, after: pt(3), ...exactLine(10) },
        keepNext,
        keepLines: true,
        children: [run('• ', BULLET), ...labelOrLinkRuns(line.text, hyperlinks, BULLET)],
      })
    case 'summary':
      return para({ spacing: { before: 0, after: pt(4), ...exactLine(10.5) }, keepNext, children: linkifyLine(line.text, hyperlinks, SUMMARY) })
    case 'secondary':
      return para({ spacing: { before: 0, after: pt(3), ...exactLine(9.5) }, keepNext, children: linkifyLine(line.text, hyperlinks, SECONDARY) })
    case 'text':
      return para({
        spacing: { before: 0, after: pt(3), ...exactLine(10) },
        keepNext,
        keepLines: true,
        children: labelOrLinkRuns(line.text, hyperlinks, BODY),
      })
  }
}

export async function generateCVDocx(
  cvText: string,
  _jobTitle: string = 'CV',
  hyperlinks: CVHyperlink[] = []
): Promise<Buffer> {
  const cv = parseCv(cvText)
  const children: Paragraph[] = []

  // ── header: name, role, contact, then the one 2pt accent rule ──
  const headerParas: { spacing: { before: number; line?: number; lineRule?: typeof LineRuleType.EXACT }; runs: (TextRun | ExternalHyperlink)[] }[] = []
  if (cv.name) {
    headerParas.push({
      spacing: { before: 0, ...exactLine(26, 1.05) },
      runs: [run(cv.name, { size: half(26), color: INK, bold: true }, { characterSpacing: tracking(-0.025, 26) })],
    })
  }
  if (cv.role) {
    headerParas.push({ spacing: { before: pt(5) }, runs: [run(cv.role, { size: half(12), color: ACCENT })] })
  }
  if (cv.contact.length) {
    const runs: (TextRun | ExternalHyperlink)[] = []
    cv.contact.forEach((part, idx) => {
      if (idx > 0) runs.push(run('  |  ', CONTACT_STYLE))
      runs.push(...linkifyLine(part, hyperlinks, CONTACT_STYLE))
    })
    headerParas.push({ spacing: { before: pt(7) }, runs })
  }
  const rule = { bottom: { color: ACCENT, style: BorderStyle.SINGLE, size: 16, space: SPACING.ruleBefore } }
  headerParas.forEach((p, i) => {
    const last = i === headerParas.length - 1
    children.push(para({
      spacing: { ...p.spacing, after: last ? SPACING.ruleAfter : 0 },
      border: last ? rule : undefined,
      children: p.runs,
    }))
  })

  // ── body ──
  cv.sections.forEach((section, s) => {
    if (section.label) {
      children.push(para({
        spacing: { before: s === 0 ? 0 : SPACING.section, after: SPACING.labelAfter },
        keepNext: true, // never let Word strand a heading alone at the bottom of a page
        children: [run(section.label.toUpperCase(), { size: half(8.5), color: ACCENT, bold: true }, { characterSpacing: tracking(0.18, 8.5) })],
      }))
    }
    let firstEntry = true
    for (const entry of section.entries) {
      if (!entry.header) {
        entry.lines.forEach((line) => children.push(lineParagraph(line, hyperlinks, false)))
        continue
      }
      const { title, date } = entry.header
      const headerRuns: (TextRun | Tab)[] = [
        run(title, { size: half(11.5), color: INK, bold: true }, { characterSpacing: tracking(-0.01, 11.5) }),
      ]
      // Right tab, not a table or text box: the title, the tab and the date
      // are one paragraph, in order, for anything reading the XML.
      if (date) {
        headerRuns.push(new TextRun({ children: [new Tab()], font: RUN_FONT, size: half(9) }))
        headerRuns.push(run(date, { size: half(9), color: MUTED }))
      }
      children.push(para({
        spacing: { before: firstEntry ? 0 : SPACING.role, after: pt(5) },
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
        keepNext: entry.lines.length > 0,
        keepLines: true,
        children: headerRuns,
      }))
      const keep = keepWithNextFlags(entry.lines.length)
      entry.lines.forEach((line, i) => children.push(lineParagraph(line, hyperlinks, keep[i])))
      firstEntry = false
    }
  })

  const [regular, bold] = await Promise.all([
    readFile(path.join(FONT_DIR, 'PublicSans-Regular.ttf')),
    readFile(path.join(FONT_DIR, 'PublicSans-Bold.ttf')),
  ])

  const doc = new Document({
    title: cv.name || 'CV',
    creator: cv.name || undefined,
    fonts: [
      { name: FONT, data: regular },
      { name: BOLD_PLACEHOLDER, data: bold },
    ],
    styles: {
      default: {
        document: { run: { font: RUN_FONT, size: half(10), color: INK } },
      },
    },
    sections: [{
      properties: { page: { size: PAGE, margin: MARGIN } },
      children,
    }],
  })

  return finishFontEmbedding(await Packer.toBuffer(doc))
}

// Fix-ups to the docx library's (9.x) font embedding:
// - It names each font part after the font ("word/fonts/Public Sans.odttf").
//   A space isn't allowed in a part name, and Word refuses the whole file as
//   corrupt — the parts are renamed font1.odttf, font2.odttf.
// - It embeds each font as the *regular* face of its own family. Public Sans
//   Bold must be the bold face of "Public Sans" (its name table says family
//   "Public Sans", style "Bold"), so it's embedded under a placeholder family
//   and its embedding moved here: <w:embedBold> on Public Sans.
// - altName Arial + family "swiss": what Word substitutes when the embedded
//   font isn't used. embedTrueTypeFonts in settings, so the fonts stay
//   embedded if the user saves the file again in Word.
// Checked by opening the result in Word 365 (2026-10-14) on a machine without
// Public Sans installed: it renders in Public Sans, regular and bold.
const BOLD_PLACEHOLDER = 'Public Sans Bold Face'

async function finishFontEmbedding(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer)

  const relsPath = 'word/_rels/fontTable.xml.rels'
  let rels = await zip.file(relsPath)!.async('string')
  const targets = Array.from(rels.matchAll(/Target="(fonts\/[^"]+)"/g), (m) => m[1])
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]
    const renamed = `fonts/font${i + 1}.odttf`
    const part = zip.file(`word/${target}`)
    if (!part) throw new Error(`generate-cv: embedded font part missing: ${target}`)
    zip.file(`word/${renamed}`, await part.async('nodebuffer'))
    zip.remove(`word/${target}`)
    rels = rels.replace(`Target="${target}"`, `Target="${renamed}"`)
  }
  zip.file(relsPath, rels)

  const fontTablePath = 'word/fontTable.xml'
  let fontTable = await zip.file(fontTablePath)!.async('string')

  const fontEl = (fontName: string) => new RegExp(`<w:font w:name="${fontName}">[\\s\\S]*?</w:font>`)
  const boldEl = fontTable.match(fontEl(BOLD_PLACEHOLDER))?.[0]
  const regularEl = fontTable.match(fontEl(FONT))?.[0]
  const embed = boldEl?.match(/<w:embedRegular ([^>]*?)\/>/)
  if (!boldEl || !regularEl || !embed) throw new Error('generate-cv: embedded font table not as expected')

  const patched = regularEl
    .replace(/<w:family w:val="[^"]*"\/>/, '<w:altName w:val="Arial"/><w:family w:val="swiss"/>')
    .replace('</w:font>', `<w:embedBold ${embed[1]}/></w:font>`)
  fontTable = fontTable.replace(boldEl, '').replace(regularEl, patched)
  zip.file(fontTablePath, fontTable)

  const settingsPath = 'word/settings.xml'
  const settings = await zip.file(settingsPath)?.async('string')
  if (settings && !settings.includes('w:embedTrueTypeFonts')) {
    // CT_Settings is an ordered sequence: embedTrueTypeFonts follows
    // displayBackgroundShape (and the print* settings, which the library
    // doesn't write) — out of order, Word reports the file as corrupt.
    zip.file(settingsPath, settings.includes('<w:displayBackgroundShape/>')
      ? settings.replace('<w:displayBackgroundShape/>', '<w:displayBackgroundShape/><w:embedTrueTypeFonts/>')
      : settings.replace(/(<w:settings[^>]*>)/, '$1<w:embedTrueTypeFonts/>'))
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
