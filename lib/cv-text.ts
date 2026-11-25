// Reading a plain-text CV (Claude-authored: tailored or generated) into its
// parts: the header (name, role line, contact), then sections of entries
// (a role or degree with the lines under it). Pure — no Node APIs — so the
// Word renderer (lib/generate-cv.ts) and the on-screen preview
// (app/components/CVPreview.tsx) read a CV the same way.
// Mirrors ai-service/utils/cv_pdf.py, which renders the PDF; a rule changed
// here changes there too.

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

// Hebrew headings, by the canonical section they are. They keep their own
// Hebrew text (there's no case to normalise); the kind decides their order.
// Mirrors _HEBREW_SECTIONS in cv_pdf.py.
const HEBREW_SECTIONS: Record<string, string> = {
  'תקציר': 'Summary', 'סיכום': 'Summary', 'סיכום מקצועי': 'Summary', 'פרופיל': 'Summary',
  'פרופיל מקצועי': 'Summary', 'על עצמי': 'Summary', 'תמצית': 'Summary',
  'ניסיון': 'Experience', 'ניסיון תעסוקתי': 'Experience', 'ניסיון מקצועי': 'Experience',
  'ניסיון עבודה': 'Experience', 'תעסוקה': 'Experience', 'היסטוריה תעסוקתית': 'Experience',
  'השכלה': 'Education', 'השכלה אקדמית': 'Education', 'לימודים': 'Education',
  'כישורים': 'Skills', 'מיומנויות': 'Skills', 'כישורים טכניים': 'Skills', 'מיומנויות טכניות': 'Skills',
  'פרויקטים': 'Projects', 'פרוייקטים': 'Projects', 'פרויקטים אישיים': 'Projects',
  'הסמכות': 'Certifications', 'תעודות': 'Certifications', 'פרסים': 'Awards',
  'שפות': 'Languages', 'פרסומים': 'Publications', 'ממליצים': 'References', 'המלצות': 'References',
}

const HEBREW_LETTERS = /[א-תיִ-ﭏ]/g

// A CV written mostly in Hebrew — a majority of letters, since Hebrew tech
// CVs carry plenty of English. Mirrors _is_rtl_document in cv_pdf.py.
export function isRtlCv(text: string): boolean {
  return (text.match(HEBREW_LETTERS)?.length ?? 0) > (text.match(/[A-Za-z]/g)?.length ?? 0)
}

function sectionKey(line: string): string {
  return line.trim().replace(/:$/, '').toLowerCase()
}

// The canonical section a heading is ("Summary", "Experience"…), English or
// Hebrew; null for anything else.
function sectionKind(line: string): string | null {
  const key = sectionKey(line)
  return CANONICAL_SECTIONS[key] ?? HEBREW_SECTIONS[key] ?? null
}

function isSectionHeader(line: string): boolean {
  return sectionKind(line) !== null
}

function canonicalSectionText(line: string): string {
  const key = sectionKey(line)
  if (CANONICAL_SECTIONS[key]) return CANONICAL_SECTIONS[key]
  const trimmed = line.trim().replace(/:$/, '')
  if (HEBREW_SECTIONS[key]) return trimmed
  return trimmed.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

// A section header we don't recognize by name (e.g. "Hackathons",
// "Volunteering") — not a CANONICAL_SECTIONS keyword, so we keep its own
// wording rather than forcing it into one of the five. Short,
// punctuation/digit-free, title-cased; confirmed by parseCv only when the
// next line is a bullet or role header, so an ordinary short sentence never
// gets mistaken for a heading.
function isBareHeadingCandidate(line: string): boolean {
  const trimmed = line.trim().replace(/:$/, '')
  if (!trimmed || trimmed.length > 30) return false
  if (/[.,;()@|]/.test(trimmed)) return false
  if (/\d/.test(trimmed)) return false
  const words = trimmed.split(/\s+/)
  if (words.length === 0 || words.length > 4) return false
  // Hebrew has no capitals: a Hebrew word passes as it is ("שירות צבאי").
  return words.every((w) => !/[a-zA-Z]/.test(w[0]) || w[0] === w[0].toUpperCase() || /[א-ת]/.test(w[0]))
}

function isBullet(line: string): boolean {
  return line.startsWith('- ') || line.startsWith('• ') || line.startsWith('* ') || line.startsWith('o ') || line.startsWith('○ ') || line.startsWith('● ')
}

// Trailing date/range detection, e.g. "... Acme Corp - 2021 - Present" or
// "... MIT (2016 - 2020)" — anchored at end-of-line so a stray 4-digit number
// mid-sentence ("2000+ GitHub stars") never gets mistaken for a date.
const MONTH = '(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?|ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)'
// "2021", "Mar 2021", "מרץ 2021", "03/2021" (the usual form in Israeli CVs).
const DATE_TOKEN = `(?:${MONTH}\\s+|\\d{1,2}[/.])?\\d{4}`
const ONGOING = 'Present|Current|Now|עד\\s+היום|היום|כיום|הווה'
const DATE_RANGE_RE = new RegExp(`\\(?\\s*(?:${DATE_TOKEN}|Present|Current)\\s*[-–—]\\s*(?:${DATE_TOKEN}|${ONGOING})\\s*\\)?\\s*$`, 'i')
const SINGLE_DATE_RE = new RegExp(`\\(?\\s*(?:${DATE_TOKEN})\\s*\\)?\\s*$`)

function splitRoleHeader(line: string): { title: string; date: string } {
  const m = DATE_RANGE_RE.exec(line) ?? SINGLE_DATE_RE.exec(line)
  if (!m || m.index === undefined) return { title: line.trim(), date: '' }
  const date = line.slice(m.index).trim().replace(/^\(|\)\s*$/g, '').trim()
  const title = line.slice(0, m.index).replace(/[\s\-–—|·,]+$/, '').trim()
  return { title: title || line.trim(), date }
}

export function isRoleHeader(line: string): boolean {
  if (isBullet(line) || isSectionHeader(line)) return false
  if (DATE_RANGE_RE.test(line) || SINGLE_DATE_RE.test(line)) return true
  const hasSeparator = ['·', '–', '—', '|'].some((s) => line.includes(s)) || / at /i.test(line)
  // Without a date, only a short line that doesn't read as a sentence: a
  // summary with an em dash in it is prose, not "Title — Company".
  return hasSeparator && line.length <= 90 && !/[.!?]\s*$/.test(line)
}

// Narrow, scoped check used only to decide whether the line immediately
// after the name (when separated by a blank line) is a contact line —
// NOT a general "does this look contact-y" test applied everywhere, which
// previously false-positived on any line with a 3+ digit run (e.g. a role
// header's "2021"), swallowing it before isRoleHeader ever ran.
function looksLikeContactLine(line: string): boolean {
  return line.includes('@') || line.includes('|') || line.includes('+') || /\d{3}/.test(line)
}

// An email, a phone number or a profile URL — a "|" alone doesn't count,
// so a headline such as "Backend Engineer | Data Platforms" isn't taken for
// the contact line.
function isStrongContactLine(line: string): boolean {
  return line.includes('@') || /\+?\d[\d\s().-]{6,}\d/.test(line) || /linkedin\.com|github\.com/i.test(line)
}

function isRoleLineCandidate(line: string): boolean {
  const s = line.trim()
  return s.length > 0 && s.length <= 80 && !/[.:]$/.test(s) && !isSectionHeader(s) && !isBullet(s) && !isStrongContactLine(s)
}

// (name, role, contact) indices into rawLines. The role line under the name
// is only taken when the CV has one — a short headline followed by a line
// that is unmistakably contact details. Never invented.
function headerIndices(rawLines: string[]): { name: number | null; role: number | null; contact: number | null } {
  const nonEmpty: number[] = []
  rawLines.forEach((l, i) => { if (l.trim()) nonEmpty.push(i) })
  if (!nonEmpty.length) return { name: null, role: null, contact: null }
  const name = nonEmpty[0]
  const rest = nonEmpty.slice(1)
  if (!rest.length) return { name, role: null, contact: null }
  const first = rawLines[rest[0]]
  if (isStrongContactLine(first)) return { name, role: null, contact: rest[0] }
  if (rest.length > 1 && isRoleLineCandidate(first) && isStrongContactLine(rawLines[rest[1]])) {
    return { name, role: rest[0], contact: rest[1] }
  }
  if (rest[0] === name + 1 || looksLikeContactLine(first)) return { name, role: null, contact: rest[0] }
  return { name, role: null, contact: null }
}

// "Languages: Python, Go, TypeScript" — a "Label: values" line. Lets "Skills
// grouped by category" fall out of normal text without inventing
// categories that aren't in the source content.
// Hebrew labels too ("שפות: עברית, אנגלית"); ״ / " and ׳ / ' appear in
// Hebrew abbreviations. Mirrors _LABEL_PREFIX_RE in cv_pdf.py.
export const LABEL_RE = /^([A-Za-zא-ת][A-Za-z0-9א-ת /&+'"׳״-]{0,30}:)\s*(.+)$/

// Merge hard line-wraps from the source PDF/DOCX text extraction back into
// logical lines. Extracted text commonly hard-breaks mid-sentence at
// wherever the original document happened to wrap — without this, a
// bullet's wrapped continuation renders as its own orphaned, unindented
// paragraph instead of flowing under the bullet it belongs to. A line
// starts a new logical line if it looks like a bullet/heading/role header,
// or if the previous logical line already looks "closed" (ends in
// sentence-terminal punctuation, or is a role header — what follows a role
// is never glued onto its date); otherwise it's appended to the previous
// one. Header lines are never a merge source or target.
function reflowLines(rawLines: string[], header: Set<number>): string[] {
  const result: string[] = []
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim()
    if (!line) continue
    if (header.has(i)) {
      result.push(line)
      continue
    }

    // "Languages: ..." / "Data: ..." category lines rarely end in punctuation,
    // so without the LABEL_RE check each one would be glued onto the previous
    // category and only the first label would render bold.
    const startsNewBlock =
      isBullet(line) || isSectionHeader(line) || isRoleHeader(line) || isBareHeadingCandidate(line) ||
      LABEL_RE.test(line)
    if (!startsNewBlock && result.length > header.size) {
      const prev = result[result.length - 1]
      const prevIsOpen = !/[.!?:]\s*$/.test(prev) && !isSectionHeader(prev) && !isRoleHeader(prev)
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
// AI's output: Summary, Experience, Education, Skills, then Projects, then the
// other canonical sections (Certifications, Languages, ...); unrecognized
// headings ("Hackathons") go last. Ties keep input order.
const SECTION_ORDER: Record<string, number> = { Summary: 0, Experience: 1, Education: 2, Skills: 3, Projects: 4 }
const OTHER_CANONICAL_RANK = 5
const NONSTANDARD_RANK = 6

function sectionRank(heading: string): number {
  const kind = sectionKind(heading)
  if (kind === null) return NONSTANDARD_RANK
  return SECTION_ORDER[kind] ?? OTHER_CANONICAL_RANK
}

export type CvLine =
  | { kind: 'bullet'; text: string }      // text without its bullet mark
  | { kind: 'summary'; text: string }     // a paragraph of the Summary section
  | { kind: 'secondary'; text: string }   // the note straight under a role header (company, location, degree)
  | { kind: 'text'; text: string }        // anything else (incl. "Label: values")

export interface CvEntry {
  header: { title: string; date: string } | null  // null: loose lines, not under a role
  lines: CvLine[]
}

export interface CvSection {
  label: string | null  // null: lines before the first heading
  entries: CvEntry[]
}

export interface ParsedCv {
  name: string
  role: string | null
  contact: string[]     // the contact line's "|"-separated parts
  sections: CvSection[]
}

export function parseCv(cvText: string): ParsedCv {
  const rawLines = cvText.split('\n').map((l) => l.trim())
  const header = headerIndices(rawLines)
  const headerSet = new Set([header.name, header.role, header.contact].filter((i): i is number => i !== null))
  const lines = reflowLines(rawLines, headerSet)

  // The reflowed header keeps raw order: name, then role, then contact.
  const headerCount = headerSet.size
  const name = headerCount ? lines[0] : ''
  const role = header.role !== null ? lines[1] : null
  const contactLine = header.contact !== null ? lines[headerCount - 1] : null
  const contact = contactLine ? contactLine.split('|').map((p) => p.trim()).filter(Boolean) : []

  // Headings not in CANONICAL_SECTIONS (e.g. "Hackathons") still get the
  // heading treatment if the line looks heading-shaped AND is immediately
  // followed by a bullet or role header — otherwise a short sentence could
  // be mistaken for one. The line straight under a role header is its
  // company or location ("Tel Aviv", "תל אביב"), never a heading.
  const body = lines.slice(headerCount)
  const sections: (CvSection & { rank: number; kind: string | null })[] = []
  body.forEach((line, i) => {
    const next = body[i + 1]
    const underRole = i > 0 && isRoleHeader(body[i - 1])
    const isHeading =
      isSectionHeader(line) ||
      (!isBullet(line) && !underRole && isBareHeadingCandidate(line) && next !== undefined && (isBullet(next) || isRoleHeader(next)))
    if (isHeading) {
      const label = isSectionHeader(line) ? canonicalSectionText(line) : line.replace(/:$/, '')
      sections.push({ label, entries: [], rank: sectionRank(line), kind: sectionKind(line) })
      return
    }
    if (!sections.length) sections.push({ label: null, entries: [], rank: -1, kind: null })
    const section = sections[sections.length - 1]
    const entries = section.entries
    const open = entries.length ? entries[entries.length - 1] : null

    if (isRoleHeader(line) && section.kind !== 'Summary') {
      entries.push({ header: splitRoleHeader(line), lines: [] })
      return
    }

    let item: CvLine
    if (isBullet(line)) item = { kind: 'bullet', text: line.replace(/^[-•*o○●]\s+/, '') }
    else if (section.kind === 'Summary') item = { kind: 'summary', text: line }
    else if (open?.header && !open.lines.length && !LABEL_RE.test(line)) item = { kind: 'secondary', text: line }
    else item = { kind: 'text', text: line }

    if (open?.header) open.lines.push(item)
    else entries.push({ header: null, lines: [item] })
  })

  // Lines before the first heading (rank -1) stay on top; stable sort.
  sections.sort((a, b) => a.rank - b.rank)
  return { name, role, contact, sections: sections.map(({ label, entries }) => ({ label, entries })) }
}

// A role's header never ends a page: it keeps its first line (first two,
// once it has four), and its last two lines stay together. Per line under
// the header, whether it keeps with the next one — the PDF's _entry_chunks.
export function keepWithNextFlags(count: number): boolean[] {
  if (count <= 2) return Array.from({ length: count }, (_, i) => i < count - 1)
  if (count === 3) return [false, true, false]
  return Array.from({ length: count }, (_, i) => i === 0 || i === count - 2)
}
