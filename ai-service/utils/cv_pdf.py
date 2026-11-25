import re
import unicodedata
from copy import copy
from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from itertools import groupby
from pathlib import Path
from xml.sax.saxutils import escape as _xml_escape

from bidi import algorithm as _bidi
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    HRFlowable,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
)

# ── design ─────────────────────────────────────────────────────────────────
# Single column, linear document order, so Greenhouse, Lever and Ashby parse
# it as written. Public Sans (SIL OFL, fsType 0 = installable embedding) is
# embedded as a subset; embedded TrueType gets a ToUnicode map, so "–", "•"
# and curly quotes extract as themselves. (The old Helvetica core font came
# back as U+FFFD for those, which is why everything used to be folded to
# ASCII.)
#
# Public Sans has no Hebrew. Hebrew letters (and ₪) are set in Noto Sans
# Hebrew (SIL OFL) of the same weight, chosen character by character, and a
# CV written mostly in Hebrew is laid out right to left (see _BidiParagraph).
# A letter neither font has (Arabic, Cyrillic, CJK…) raises
# UnsupportedScriptError rather than rendering as boxes.
_FONT_DIR = Path(__file__).resolve().parent.parent / "fonts"
_FONTS = {
    "PS-Regular": "PublicSans-Regular.ttf",
    "PS-Medium": "PublicSans-Medium.ttf",
    "PS-SemiBold": "PublicSans-SemiBold.ttf",
    "PS-Bold": "PublicSans-Bold.ttf",
    # Bold with the labels' 0.18em letter-spacing built into the advance
    # widths — see fonts/make_tracked_font.py for why not character spacing.
    "PS-Label": "PublicSansTracked-Bold.ttf",
    "NH-Regular": "NotoSansHebrew-Regular.ttf",
    "NH-Medium": "NotoSansHebrew-Medium.ttf",
    "NH-SemiBold": "NotoSansHebrew-SemiBold.ttf",
    "NH-Bold": "NotoSansHebrew-Bold.ttf",
}
for _name, _file in _FONTS.items():
    pdfmetrics.registerFont(TTFont(_name, str(_FONT_DIR / _file)))
pdfmetrics.registerFontFamily("PS-Regular", normal="PS-Regular", bold="PS-Bold")

# The Hebrew face for each Public Sans face. The labels' tracking is for
# Latin capitals; Hebrew has no case and is set untracked.
_HEBREW_FACE = {
    "PS-Regular": "NH-Regular", "PS-Medium": "NH-Medium", "PS-SemiBold": "NH-SemiBold",
    "PS-Bold": "NH-Bold", "PS-Label": "NH-Bold",
}
_LATIN_CMAP = frozenset(pdfmetrics.getFont("PS-Regular").face.charToGlyph)
_HEBREW_CMAP = frozenset(pdfmetrics.getFont("NH-Regular").face.charToGlyph)


def _face_for(ch: str, font: str) -> str:
    """Public Sans where it has the character, else its Noto Sans Hebrew weight."""
    code = ord(ch)
    if code in _LATIN_CMAP or code not in _HEBREW_CMAP:
        return font
    return _HEBREW_FACE[font]


_HEBREW_LETTER_RE = re.compile(r"[\u05D0-\u05EA\uFB1D-\uFB4F]")
_LATIN_LETTER_RE = re.compile(r"[A-Za-z]")


def _has_hebrew(text: str) -> bool:
    return bool(_HEBREW_LETTER_RE.search(text))


def _is_rtl_document(text: str) -> bool:
    """A CV written mostly in Hebrew. Tech CVs in Hebrew carry plenty of
    English (skills, company names, emails), so it's a majority of letters,
    not "any Hebrew"; an English CV with a Hebrew university name stays LTR."""
    return len(_HEBREW_LETTER_RE.findall(text)) > len(_LATIN_LETTER_RE.findall(text))


class UnsupportedScriptError(ValueError):
    """The CV has letters in a script neither embedded font covers. Raised
    instead of producing a PDF with boxes in it; callers fall back to Word
    (Next.js) or stop the application for the user (the AI service)."""

    def __init__(self, chars: list[str]):
        self.chars = chars
        super().__init__("no font for: " + " ".join(f"U+{ord(c):04X}" for c in chars[:10]))


# What the user is told when an application stops on it. The download on
# Applications comes as Word for such a CV (lib/cv-file.ts falls back).
CV_SCRIPT_MESSAGE = (
    "Your CV has text in a script we can't put into a PDF yet (English and Hebrew are supported), "
    "so the application wasn't sent. Download your CV from Applications — it comes as a Word file — "
    "and apply on the job's page."
)


def _covered(ch: str) -> bool:
    return ch.isspace() or ord(ch) in _LATIN_CMAP or ord(ch) in _HEBREW_CMAP


def unsupported_characters(text: str) -> list[str]:
    """Letters, marks and digits the PDF can't set (distinct, in order)."""
    found: list[str] = []
    for ch in _clean_text(text):
        if not _covered(ch) and unicodedata.category(ch)[0] in "LMN" and ch not in found:
            found.append(ch)
    return found


def _clean_text(text: str) -> str:
    """Drop what can't be drawn and carries no words: format controls
    (LRM/RLM, zero-width joiners, soft hyphens — invisible, and in neither
    font), Hebrew points and cantillation (modern Hebrew is written without
    them, and reportlab can't position combining marks), and stray symbols
    neither font has (emoji, ✓), which would otherwise print as boxes."""
    out = []
    for ch in text:
        cat = unicodedata.category(ch)
        if cat == "Cf" or (cat == "Mn" and "\u0591" <= ch <= "\u05C7"):
            continue
        if cat[0] in "SPZ" and not _covered(ch):
            continue
        out.append(ch)
    return "".join(out)


INK = "#15181D"          # body text, names, job titles
BULLET_INK = "#22262C"   # bullet text
CONTACT = "#4B5159"      # contact line
MUTED = "#6B727B"        # dates, secondary lines
ACCENT = "#2C5F7C"       # ONLY the role line under the name and section labels

_PAGE_SIZE = A4
_MARGIN_TOP, _MARGIN_SIDE, _MARGIN_BOTTOM = 60, 66, 54

_BODY_LEADING = 1.52


@dataclass(frozen=True)
class _Spacing:
    """Vertical gaps (pt). Type sizes never change; only these do, and only
    when tightening them saves a page (see generate_cv_pdf)."""
    section: float = 26      # between sections
    role: float = 17         # between roles in a section
    label_after: float = 9   # section label -> its first line
    rule_before: float = 14  # contact line -> header rule
    rule_after: float = 26   # header rule -> first section label


_NORMAL = _Spacing()
_COMPACT = _Spacing(section=20, role=13, label_after=7, rule_before=11, rule_after=20)

# Canonical ATS-safe section names. Anything not in this map keeps its own
# (title-cased) text rather than being forced into one of these — we only
# normalize the headings parsers are told to expect, never invent new ones.
_CANONICAL_SECTIONS = {
    "summary": "Summary", "professional summary": "Summary", "objective": "Summary", "profile": "Summary",
    "work experience": "Experience", "experience": "Experience", "employment": "Experience",
    "employment history": "Experience", "professional experience": "Experience",
    "education": "Education", "academic background": "Education",
    "skills": "Skills", "technical skills": "Skills", "core competencies": "Skills", "competencies": "Skills",
    "projects": "Projects", "portfolio": "Projects", "personal projects": "Projects",
    "certifications": "Certifications", "certificates": "Certifications", "awards": "Awards",
    "languages": "Languages", "publications": "Publications", "references": "References",
}

# Hebrew headings, by the canonical section they are. They keep their own
# Hebrew text (there's no case to normalise); the kind decides their order.
# Mirrors HEBREW_SECTIONS in lib/cv-text.ts.
_HEBREW_SECTIONS = {
    "תקציר": "Summary", "סיכום": "Summary", "סיכום מקצועי": "Summary", "פרופיל": "Summary",
    "פרופיל מקצועי": "Summary", "על עצמי": "Summary", "תמצית": "Summary",
    "ניסיון": "Experience", "ניסיון תעסוקתי": "Experience", "ניסיון מקצועי": "Experience",
    "ניסיון עבודה": "Experience", "תעסוקה": "Experience", "היסטוריה תעסוקתית": "Experience",
    "השכלה": "Education", "השכלה אקדמית": "Education", "לימודים": "Education",
    "כישורים": "Skills", "מיומנויות": "Skills", "כישורים טכניים": "Skills", "מיומנויות טכניות": "Skills",
    "פרויקטים": "Projects", "פרוייקטים": "Projects", "פרויקטים אישיים": "Projects",
    "הסמכות": "Certifications", "תעודות": "Certifications", "פרסים": "Awards",
    "שפות": "Languages", "פרסומים": "Publications", "ממליצים": "References", "המלצות": "References",
}


_MONTH = r"(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?|ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)"
# "2021", "Mar 2021", "מרץ 2021", "03/2021" (the usual form in Israeli CVs).
_DATE_TOKEN = rf"(?:{_MONTH}\s+|\d{{1,2}}[/.])?\d{{4}}"
_ONGOING = r"Present|Current|Now|עד\s+היום|היום|כיום|הווה"
_DATE_RANGE_RE = re.compile(
    rf"\(?\s*({_DATE_TOKEN}|Present|Current)\s*[-–—]\s*({_DATE_TOKEN}|{_ONGOING})\s*\)?\s*$",
    re.IGNORECASE,
)
_SINGLE_DATE_RE = re.compile(rf"\(?\s*({_DATE_TOKEN})\s*\)?\s*$")

_LINK_PATTERNS: list[tuple[re.Pattern, "callable"]] = [
    (re.compile(r"github\.com/([a-zA-Z0-9_-]+)/([a-zA-Z0-9_-]+)"), lambda m: f"https://github.com/{m.group(1)}/{m.group(2)}"),
    (re.compile(r"github\.com/([a-zA-Z0-9_-]+)"), lambda m: f"https://github.com/{m.group(1)}"),
    (re.compile(r"linkedin\.com/in/([a-zA-Z0-9_-]+)"), lambda m: f"https://linkedin.com/in/{m.group(1)}"),
    (re.compile(r"https?://[^\s,;)>\]'\"]+"), lambda m: m.group(0)),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), lambda m: f"mailto:{m.group(0)}"),
]


def _link_pieces(line: str) -> list[tuple[str, str | None]]:
    """The line as (text, url) pieces: recognized URLs/emails carry their
    link, the rest None."""
    matches: list[tuple[int, int, str]] = []
    for pattern, build_url in _LINK_PATTERNS:
        for m in pattern.finditer(line):
            start, end = m.span()
            if any(start < e and end > s for s, e, _ in matches):
                continue
            matches.append((start, end, build_url(m)))
    matches.sort(key=lambda t: t[0])
    pieces: list[tuple[str, str | None]] = []
    pos = 0
    for start, end, url in matches:
        if start < pos:
            continue
        if start > pos:
            pieces.append((line[pos:start], None))
        pieces.append((line[start:end], url))
        pos = end
    if pos < len(line):
        pieces.append((line[pos:], None))
    return pieces


def _linkify(line: str) -> str:
    """Return reportlab mini-XML markup with recognized URLs/emails as <link>
    runs. Links stay clickable but take the surrounding text's colour, with
    no underline — the accent is reserved for the role line and labels."""
    return "".join(
        f'<link href="{_xml_escape(url)}">{_xml_escape(text)}</link>' if url else _xml_escape(text)
        for text, url in _link_pieces(line)
    )


# Hebrew labels too ("שפות: עברית, אנגלית"); ״ / " and ׳ / ' appear in Hebrew
# abbreviations. Mirrors LABEL_RE in lib/cv-text.ts.
_LABEL_PREFIX_RE = re.compile(r"^([A-Za-zא-ת][A-Za-z0-9א-ת /&+'\"׳״-]{0,30}:)\s*(.+)$")


def _is_label_line(line: str) -> bool:
    """'Languages: Python, SQL' — a "Label: values" line (skills by category etc.)."""
    return bool(_LABEL_PREFIX_RE.match(line.strip()))


def _label_markup(line: str) -> str | None:
    """'Languages: Python, SQL' -> semibold 'Languages:' label. None if no match."""
    m = _LABEL_PREFIX_RE.match(line)
    if not m:
        return None
    return f'<font name="PS-SemiBold" color="{INK}">{_xml_escape(m.group(1))}</font> {_linkify(m.group(2))}'


def _section_kind(line: str) -> str | None:
    """The canonical section a heading is ("Summary", "Experience"…), English
    or Hebrew; None for anything else."""
    key = line.strip().rstrip(":").lower()
    return _CANONICAL_SECTIONS.get(key) or _HEBREW_SECTIONS.get(key)


def _is_section_header(line: str) -> bool:
    return _section_kind(line) is not None


def _canonical_section_text(line: str) -> str:
    text = line.strip().rstrip(":")
    key = text.lower()
    if key in _HEBREW_SECTIONS:
        return text
    return _CANONICAL_SECTIONS.get(key, text.title())


def _is_bare_heading_candidate(line: str) -> bool:
    """A section header we don't recognize by name (e.g. 'Hackathons',
    'Volunteering') — not one of the CANONICAL_SECTIONS keywords, so we keep
    its own wording rather than forcing it into one of the five. Short,
    punctuation/digit-free, title-cased; confirmed by generate_cv_pdf only
    when the next line is a bullet or role header, so an ordinary short
    sentence never gets mistaken for a heading."""
    stripped = line.strip().rstrip(":")
    if not stripped or len(stripped) > 30:
        return False
    if any(ch in stripped for ch in ".,;()@|"):
        return False
    if re.search(r"\d", stripped):
        return False
    words = stripped.split()
    if not words or len(words) > 4:
        return False
    # Hebrew has no capitals: a Hebrew word passes as it is ("שירות צבאי").
    return all(w[0].isupper() or _HEBREW_LETTER_RE.match(w[0]) for w in words if w[0].isalpha())


def _is_bullet(line: str) -> bool:
    return line.startswith(("- ", "• ", "* ", "o ", "○ ", "● "))


def _is_contact_line(line: str) -> bool:
    return "@" in line or "|" in line or "+" in line or bool(re.search(r"\d{3}", line))


_PHONE_RE = re.compile(r"\+?\d[\d\s().-]{6,}\d")


def _is_strong_contact_line(line: str) -> bool:
    """An email, a phone number or a profile URL — unlike _is_contact_line,
    a "|" alone doesn't count, so a headline such as "Backend Engineer |
    Data Platforms" isn't taken for the contact line."""
    return "@" in line or bool(_PHONE_RE.search(line)) or "linkedin.com" in line.lower() or "github.com" in line.lower()


def _is_role_line_candidate(line: str) -> bool:
    """A short headline under the name ("Senior Backend Engineer")."""
    s = line.strip()
    return (
        0 < len(s) <= 80
        and not s.endswith((".", ":"))
        and not _is_section_header(s)
        and not _is_bullet(s)
        and not _is_strong_contact_line(s)
    )


def _header_indices(raw_lines: list[str]) -> tuple[int | None, int | None, int | None]:
    """(name, role, contact) indices into raw_lines. The role line is only
    taken when the CV has one — a short headline directly under the name,
    followed by a line that is unmistakably contact details. Never invented."""
    non_empty = [i for i, ln in enumerate(raw_lines) if ln.strip()]
    if not non_empty:
        return None, None, None
    name = non_empty[0]
    rest = non_empty[1:]
    if not rest:
        return name, None, None
    first = raw_lines[rest[0]]
    if _is_strong_contact_line(first):
        return name, None, rest[0]
    if len(rest) > 1 and _is_role_line_candidate(first) and _is_strong_contact_line(raw_lines[rest[1]]):
        return name, rest[0], rest[1]
    if rest[0] == name + 1 or _is_contact_line(first):
        return name, None, rest[0]
    return name, None, None


def _split_role_header(line: str) -> tuple[str, str]:
    """'Senior Engineer, Acme Corp - 2020 - Present' -> (left, 'right date')."""
    m = _DATE_RANGE_RE.search(line) or _SINGLE_DATE_RE.search(line)
    if not m:
        return line.strip(), ""
    date_text = line[m.start():m.end()].strip("() \t")
    left = line[:m.start()].rstrip(" -–—|·,").strip()
    return (left or line.strip()), date_text


def _is_role_header(line: str) -> bool:
    if _is_bullet(line) or _is_section_header(line):
        return False
    # Anchored at end-of-line, not "any 4-digit number anywhere" — otherwise
    # a body sentence like "(2000+ GitHub stars)" false-positives as a date.
    if _DATE_RANGE_RE.search(line) or _SINGLE_DATE_RE.search(line):
        return True
    has_separator = any(sep in line for sep in ("·", "–", "—", "|")) or " at " in line.lower()
    # Without a date, only a short line that doesn't read as a sentence: a
    # summary with an em dash in it is prose, not "Title — Company".
    return has_separator and len(line) <= 90 and not line.rstrip().endswith((".", "!", "?"))


def _reflow_lines(raw_lines: list[str], name_idx: int | None, contact_idx: int | None, role_idx: int | None = None) -> list[str]:
    """Merge hard line-wraps from the source PDF/DOCX text extraction back
    into logical lines. Extracted text commonly hard-breaks mid-sentence at
    wherever the original document happened to wrap — without this, a
    bullet's wrapped continuation renders as its own orphaned, unindented
    paragraph instead of flowing under the bullet it belongs to. A line
    starts a new logical line if it looks like a bullet/heading/role header,
    or if the previous logical line already looks "closed" (ends in
    sentence-terminal punctuation); otherwise it's appended to the previous
    one. name/role/contact lines are never a merge source or target."""
    header = {i for i in (name_idx, role_idx, contact_idx) if i is not None}
    result: list[str] = []
    for i, raw in enumerate(raw_lines):
        line = raw.strip()
        if not line:
            continue
        if i in header:
            result.append(line)
            continue

        starts_new_block = (
            _is_bullet(line)
            or _is_section_header(line)
            or _is_role_header(line)
            or _is_bare_heading_candidate(line)
            # "Languages: ..." / "Data: ..." category lines rarely end in
            # punctuation, so without this each one would be glued onto the
            # previous category and only the first label would render bold.
            or _is_label_line(line)
        )
        if not starts_new_block and len(result) > len(header):
            prev = result[-1]
            # A role header is complete on its own line; what follows it (a
            # company or degree note) is never glued onto its date.
            prev_is_open = (
                not prev.rstrip().endswith((".", "!", "?", ":"))
                and not _is_section_header(prev)
                and not _is_role_header(prev)
            )
            if prev_is_open:
                result[-1] = f"{prev} {line}"
                continue
        result.append(line)
    return result


# Canonical section order, applied by the renderer rather than trusted to the
# AI's output: Summary, Experience, Education, Skills, then Projects, then the
# other canonical sections (Certifications, Languages, ...); unrecognized
# headings ("Hackathons") go last. Ties keep input order.
# Mirrors SECTION_ORDER in lib/generate-cv.ts.
_SECTION_ORDER = {"Summary": 0, "Experience": 1, "Education": 2, "Skills": 3, "Projects": 4}
_OTHER_CANONICAL_RANK = 5
_NONSTANDARD_RANK = 6


def _section_rank(heading: str) -> int:
    kind = _section_kind(heading)
    if kind is None:
        return _NONSTANDARD_RANK
    return _SECTION_ORDER.get(kind, _OTHER_CANONICAL_RANK)


def _order_sections(lines: list[str], heading_idxs: set[int]) -> list[tuple[str, bool]]:
    """Regroup body lines into sections (heading + everything up to the next
    heading) and stable-sort the sections by _section_rank. Lines before the
    first heading stay on top. Returns (line, is_heading) pairs."""
    preamble: list[tuple[str, bool]] = []
    sections: list[tuple[int, list[tuple[str, bool]]]] = []
    for i, line in enumerate(lines):
        if i in heading_idxs:
            sections.append((_section_rank(line), [(line, True)]))
        elif sections:
            sections[-1][1].append((line, False))
        else:
            preamble.append((line, False))
    sections.sort(key=lambda s: s[0])
    return preamble + [item for _, block in sections for item in block]


# ── flowables ──────────────────────────────────────────────────────────────

def _tracked_width(text: str, font: str, size: float, char_space: float) -> float:
    return pdfmetrics.stringWidth(text, font, size) + char_space * len(text)


def _wrap_tracked(text: str, font: str, size: float, char_space: float, width: float) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}" if current else word
        if current and _tracked_width(candidate, font, size, char_space) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [""]


def _first_baseline(leading: float, size: float, line_count: int) -> float:
    """Baseline of the first line in a box of line_count * leading, with the
    half-leading above it (Public Sans' ascent is about 0.78em)."""
    return leading * line_count - (leading - size) / 2 - size * 0.78


class _TrackedText(Flowable):
    """A line (wrapping if it must) set with letter-spacing, which reportlab's
    Paragraph can't do: the name, the role line and section labels."""

    def __init__(self, text: str, font: str, size: float, leading: float, color: str, tracking_em: float = 0.0):
        super().__init__()
        self.text, self.font, self.size, self.leading, self.color = text, font, size, leading, color
        self.char_space = tracking_em * size
        self._lines: list[str] = []

    def wrap(self, avail_width, avail_height):
        self._lines = _wrap_tracked(self.text, self.font, self.size, self.char_space, avail_width)
        self.width = avail_width
        return avail_width, self.leading * len(self._lines)

    def draw(self):
        t = self.canv.beginText()
        t.setFont(self.font, self.size)
        t.setCharSpace(self.char_space)
        t.setFillColor(self.color)
        y = _first_baseline(self.leading, self.size, len(self._lines))
        for line in self._lines:
            t.setTextOrigin(0, y)
            t.textOut(line)
            y -= self.leading
        self.canv.drawText(t)


_TITLE_FONT, _TITLE_SIZE, _TITLE_LEADING, _TITLE_TRACK = "PS-SemiBold", 11.5, 14.5, -0.01
_DATE_FONT, _DATE_SIZE = "PS-Regular", 9
_DATE_GAP = 14  # minimum space between a title and its date


class _EntryHeader(Flowable):
    """Job title left, dates right, on one line.

    The gap between them is a real space character, horizontally scaled to
    reach the date. A plain jump to the right margin leaves an empty gap that
    layout-based extractors (pdfminer, which many resume parsers use) read
    as a column break, and they file the date after the role's first bullet.
    One stretched glyph keeps "Title  Jan 2023 – Present" a single text line
    for pdfminer, PyMuPDF, pypdf and pdftotext -raw (checked 2026-10-14).
    """

    def __init__(self, title: str, date: str):
        super().__init__()
        self.title, self.date = title, date
        self.char_space = _TITLE_TRACK * _TITLE_SIZE
        self._lines: list[str] = []

    def wrap(self, avail_width, avail_height):
        date_w = pdfmetrics.stringWidth(self.date, _DATE_FONT, _DATE_SIZE) if self.date else 0
        room = avail_width - (date_w + _DATE_GAP if self.date else 0)
        self._lines = _wrap_tracked(self.title, _TITLE_FONT, _TITLE_SIZE, self.char_space, room)
        self.width, self._date_w = avail_width, date_w
        return avail_width, _TITLE_LEADING * len(self._lines)

    def draw(self):
        t = self.canv.beginText()
        y = _first_baseline(_TITLE_LEADING, _TITLE_SIZE, len(self._lines))
        for n, line in enumerate(self._lines):
            t.setTextOrigin(0, y)
            t.setFont(_TITLE_FONT, _TITLE_SIZE)
            t.setCharSpace(self.char_space)
            t.setFillColor(INK)
            t.textOut(line)
            if n == 0 and self.date:
                t.setCharSpace(0)
                t.setFont(_DATE_FONT, _DATE_SIZE)
                title_w = _tracked_width(line, _TITLE_FONT, _TITLE_SIZE, self.char_space)
                space_w = pdfmetrics.stringWidth(" ", _DATE_FONT, _DATE_SIZE)
                gap = max(self.width - self._date_w - title_w, space_w)
                t.setHorizScale(100 * gap / space_w)
                t.textOut(" ")
                t.setHorizScale(100)
                t.setFillColor(MUTED)
                t.textOut(self.date)
            y -= _TITLE_LEADING
        self.canv.drawText(t)


# ── Hebrew: mixed fonts and right-to-left lines ────────────────────────────
# reportlab's own bidi support needs rlbidi, which isn't on PyPI, and its
# Paragraph can't switch font per character. So a line with Hebrew in it —
# or any line of a Hebrew CV — is laid out here: wrapped in logical order,
# then each line reordered for display (Unicode bidi algorithm, python-bidi)
# and drawn run by run, every character in the face that has it. An English
# CV without Hebrew never comes through here.

@dataclass(frozen=True)
class _Run:
    """Text in one style, in logical (reading) order."""
    text: str
    font: str          # the Public Sans face; Hebrew characters use its Noto Sans Hebrew twin
    size: float
    color: str
    href: str | None = None
    tracking: float = 0.0  # extra advance per character, pt


# A character with its style: (char, face, size, color, href, tracking).
_Glyph = tuple[str, str, float, str, "str | None", float]
_GAP = "\t"  # stands for the title–date gap on a role header


@lru_cache(maxsize=4096)
def _char_width(ch: str, face: str, size: float) -> float:
    return pdfmetrics.stringWidth(ch, face, size)


def _glyphs(runs: list[_Run]) -> list[_Glyph]:
    return [(ch, _face_for(ch, r.font), r.size, r.color, r.href, r.tracking) for r in runs for ch in r.text]


def _glyph_width(g: _Glyph, gap: float = 0.0) -> float:
    return gap if g[0] == _GAP else _char_width(g[0], g[1], g[2]) + g[5]


def _line_width(line: list[_Glyph], gap: float = 0.0) -> float:
    return sum(_glyph_width(g, gap) for g in line)


def _wrap_glyphs(glyphs: list[_Glyph], first_width: float, rest_width: float) -> list[list[_Glyph]]:
    """Greedy word wrap in logical order (bidi reordering is per line, after
    wrapping, as the algorithm requires). A word wider than the line is
    broken between characters."""
    lines: list[list[_Glyph]] = []
    current: list[_Glyph] = []
    width = 0.0

    def room() -> float:
        return first_width if not lines else rest_width

    for is_space, group in groupby(glyphs, key=lambda g: g[0] == " "):
        token = list(group)
        token_w = _line_width(token)
        if is_space:
            if current:
                current += token
                width += token_w
            continue
        if current and width + token_w > room() + 0.01:
            lines.append(current)
            current, width = [], 0.0
        while not current and token_w > room() + 0.01 and len(token) > 1:
            fit, acc = 0, 0.0
            while fit < len(token) and acc + _glyph_width(token[fit]) <= room():
                acc += _glyph_width(token[fit])
                fit += 1
            fit = max(fit, 1)
            lines.append(token[:fit])
            token = token[fit:]
            token_w = _line_width(token)
        current += token
        width += token_w
    if current:
        lines.append(current)
    return [_rstrip(line) for line in lines] or [[]]


def _rstrip(line: list[_Glyph]) -> list[_Glyph]:
    end = len(line)
    while end and line[end - 1][0] == " ":
        end -= 1
    return line[:end]


def _visual_order(text: str, rtl: bool) -> list[tuple[int, str]]:
    """(logical index, character as displayed) for one line, left to right.
    The steps of python-bidi's get_display, run here so each character keeps
    its index — and so its face, colour and link. Mirrored characters
    ("(" in a right-to-left run) come back mirrored."""
    storage = _bidi.get_empty_storage()
    storage["base_level"] = 1 if rtl else 0
    storage["base_dir"] = "R" if rtl else "L"
    _bidi.get_embedding_levels(text, storage)
    for i, ch in enumerate(storage["chars"]):
        ch["index"] = i
    _bidi.explicit_embed_and_overrides(storage, False)
    _bidi.resolve_weak_types(storage, False)
    _bidi.resolve_neutral_types(storage, False)
    _bidi.resolve_implicit_levels(storage, False)
    _bidi.reorder_resolved_levels(storage, False)
    _bidi.apply_mirroring(storage, False)
    return [(ch["index"], ch["ch"]) for ch in storage["chars"]]


def _draw_glyph_line(canv, line: list[_Glyph], x: float, y: float, rtl: bool, gap: float = 0.0) -> None:
    """Draw one wrapped line starting at x (its left end). The gap, if the
    line has one, is a single space glyph stretched to width — the same
    trick as _EntryHeader, so extractors keep title and date on one line."""
    if not line:
        return
    # Drawn in display order, as Word's PDFs are. Extractors apply bidi
    # themselves: PyMuPDF and pdftotext (default and -layout) read the Hebrew
    # in reading order; only pdftotext -raw reads it reversed. An ActualText
    # span fixed -raw but reversed the other three (they reorder it again),
    # so there is none (checked 2026-11-25).
    display = [(line[i], ch) for i, ch in _visual_order("".join(g[0] for g in line), rtl)]
    links: dict[str, list[float]] = {}
    t = canv.beginText()
    t.setTextOrigin(x, y)
    cursor = x
    for (face, size, color, href, tracking), group in groupby(display, key=lambda d: d[0][1:]):
        items = list(group)
        t.setFont(face, size)
        t.setFillColor(color)
        t.setCharSpace(tracking)
        for is_gap, part in groupby(items, key=lambda d: d[0][0] == _GAP):
            part = list(part)
            if is_gap:
                space_w = _char_width(" ", face, size)
                t.setCharSpace(0)
                t.setHorizScale(100 * gap / space_w)
                t.textOut(" ")
                t.setHorizScale(100)
                t.setCharSpace(tracking)
                cursor += gap
                continue
            t.textOut("".join(ch for _, ch in part))
            width = sum(_glyph_width(g) for g, _ in part)
            if href:
                span = links.setdefault(href, [cursor, cursor + width])
                span[0], span[1] = min(span[0], cursor), max(span[1], cursor + width)
            cursor += width
    canv.drawText(t)
    size = line[0][2]
    for href, (x0, x1) in links.items():
        canv.linkURL(href, (x0, y - size * 0.25, x1, y + size * 0.8), relative=1, thickness=0)


class _BidiParagraph(Flowable):
    """A paragraph of runs that may mix Hebrew and Latin, in either
    direction. Indents are from the start edge — the right one when rtl —
    so a bullet hangs on the right in a Hebrew CV. Splits across pages
    between lines."""

    def __init__(self, runs: list[_Run], leading: float, rtl: bool, *, indent: float = 0.0,
                 first_indent: float = 0.0, space_after: float = 0.0):
        super().__init__()
        self.runs, self.leading, self.rtl = runs, leading, rtl
        self.indent, self.first_indent = indent, first_indent
        self.spaceAfter = space_after
        self.size = runs[0].size if runs else 10
        self._lines: list[list[_Glyph]] | None = None
        self._first_is_first = True  # the first line here is the paragraph's first

    def wrap(self, avail_width, avail_height):
        self.width = avail_width
        if self._lines is None:
            rest = avail_width - self.indent
            self._lines = _wrap_glyphs(_glyphs(self.runs), rest - self.first_indent, rest)
        self.height = self.leading * len(self._lines)
        return avail_width, self.height

    def split(self, avail_width, avail_height):
        self.wrap(avail_width, avail_height)
        fit = int((avail_height + 0.01) // self.leading)
        if fit < 1 or fit >= len(self._lines):
            return []
        head, tail = copy(self), copy(self)
        head._lines, head.spaceAfter = self._lines[:fit], 0
        tail._lines, tail._first_is_first = self._lines[fit:], False
        return [head, tail]

    def draw(self):
        y = _first_baseline(self.leading, self.size, len(self._lines))
        for n, line in enumerate(self._lines):
            offset = self.indent + (self.first_indent if n == 0 and self._first_is_first else 0)
            x = self.width - offset - _line_width(line) if self.rtl else offset
            _draw_glyph_line(self.canv, line, x, y, self.rtl)
            y -= self.leading


class _BidiEntryHeader(Flowable):
    """_EntryHeader for a line with Hebrew in it or in a Hebrew CV: the title
    at the start edge, the dates at the far end of its first line (on the
    left in a Hebrew CV)."""

    def __init__(self, title: str, date: str, rtl: bool):
        super().__init__()
        track = 0.0 if _has_hebrew(title) else _TITLE_TRACK * _TITLE_SIZE
        self.title = _glyphs([_Run(title, _TITLE_FONT, _TITLE_SIZE, INK, tracking=track)])
        self.date = _glyphs([_Run(date, _DATE_FONT, _DATE_SIZE, MUTED)]) if date else []
        self.rtl = rtl

    def wrap(self, avail_width, avail_height):
        self.width = avail_width
        date_w = _line_width(self.date)
        room = avail_width - (date_w + _DATE_GAP if self.date else 0)
        self._lines = _wrap_glyphs(self.title, room, room)
        if self.date:
            first = self._lines[0]
            self._gap = max(avail_width - _line_width(first) - date_w, _char_width(" ", _DATE_FONT, _DATE_SIZE))
            self._lines[0] = [*first, (_GAP, _DATE_FONT, _DATE_SIZE, MUTED, None, 0.0), *self.date]
        return avail_width, _TITLE_LEADING * len(self._lines)

    def draw(self):
        y = _first_baseline(_TITLE_LEADING, _TITLE_SIZE, len(self._lines))
        for n, line in enumerate(self._lines):
            gap = self._gap if n == 0 and self.date else 0.0
            x = self.width - _line_width(line, gap) if self.rtl else 0.0
            _draw_glyph_line(self.canv, line, x, y, self.rtl, gap)
            y -= _TITLE_LEADING


# ── styles ─────────────────────────────────────────────────────────────────

_CONTACT_STYLE = ParagraphStyle(
    "CVContact", fontName="PS-Regular", fontSize=9, leading=13, textColor=CONTACT,
)
_SUMMARY_STYLE = ParagraphStyle(
    "CVSummary", fontName="PS-Regular", fontSize=10.5, leading=10.5 * _BODY_LEADING, textColor=INK, spaceAfter=4,
)
_BODY_STYLE = ParagraphStyle(
    "CVBody", fontName="PS-Regular", fontSize=10, leading=10 * _BODY_LEADING, textColor=INK, spaceAfter=3,
)
_SECONDARY_STYLE = ParagraphStyle(
    "CVSecondary", parent=_BODY_STYLE, fontSize=9.5, leading=9.5 * _BODY_LEADING, textColor=MUTED,
)
# The bullet is part of the paragraph's text ("•" + no-break space), hung
# into the indent, not reportlab's separate bulletText: drawn on its own, the
# "•" extracts as a line of its own above the bullet's text.
_BULLET_PREFIX = "• "
_BULLET_INDENT = 16
_BULLET_STYLE = ParagraphStyle(
    "CVBullet", fontName="PS-Regular", fontSize=10, leading=10 * _BODY_LEADING, textColor=BULLET_INK,
    leftIndent=_BULLET_INDENT, firstLineIndent=-pdfmetrics.stringWidth(_BULLET_PREFIX, "PS-Regular", 10),
    spaceAfter=3,
)


# ── document ───────────────────────────────────────────────────────────────

@dataclass
class _Entry:
    """A role/degree (header + the lines under it), or a loose line (header None)."""
    header: Flowable | None
    lines: list[Flowable]


def _entry_chunks(entry: _Entry) -> list[list[Flowable]]:
    """Groups that must not be split across a page. A role's header never
    ends a page: it keeps its first line (first two, once it has four), and
    its last two lines stay together, so no line is stranded alone on a
    page. Everything else may break — keeping whole roles together leaves
    half-empty pages."""
    if entry.header is None:
        return [[line] for line in entry.lines]
    lines = entry.lines
    if len(lines) <= 2:
        return [[entry.header, *lines]]
    if len(lines) == 3:
        return [[entry.header, lines[0]], lines[1:]]
    head, middle, tail = lines[:2], lines[2:-2], lines[-2:]
    return [[entry.header, *head], *[[line] for line in middle], tail]


def _style_runs(text: str, style: ParagraphStyle, *, label: bool, prefix: str = "") -> list[_Run]:
    """A body line as runs in its style: the "Label:" in semibold ink when
    label is set, links carried on their characters."""
    font, size, color = style.fontName, style.fontSize, style.textColor
    runs = [_Run(prefix, font, size, color)] if prefix else []
    m = _LABEL_PREFIX_RE.match(text) if label else None
    if m:
        runs += [_Run(m.group(1), "PS-SemiBold", size, INK), _Run(" ", font, size, color)]
        text = m.group(2)
    runs += [_Run(piece, font, size, color, href) for piece, href in _link_pieces(text)]
    return runs


def _text_flowable(text: str, style: ParagraphStyle, rtl: bool, *, label: bool, prefix: str = "") -> Flowable:
    """A body, summary, secondary or bullet line: reportlab's Paragraph for
    a line without Hebrew in a left-to-right CV (unchanged from before
    Hebrew support), _BidiParagraph otherwise."""
    if not rtl and not _has_hebrew(text):
        body = (_label_markup(text) if label else None) or _linkify(text)
        return Paragraph(_xml_escape(prefix) + body, style)
    return _BidiParagraph(
        _style_runs(text, style, label=label, prefix=prefix), style.leading, rtl,
        indent=style.leftIndent, first_indent=style.firstLineIndent, space_after=style.spaceAfter,
    )


def _single_line(text: str, font: str, size: float, leading: float, color: str, rtl: bool,
                 tracking_em: float = 0.0) -> Flowable:
    """The name, the role line or a section label. Tracking is for Latin;
    text with Hebrew in it is set untracked."""
    if not rtl and not _has_hebrew(text):
        return _TrackedText(text, font, size, leading, color, tracking_em=tracking_em)
    track = 0.0 if _has_hebrew(text) else tracking_em * size
    return _BidiParagraph([_Run(text, font, size, color, tracking=track)], leading, rtl)


def _build_story(cv_text: str, spacing: _Spacing) -> tuple[list[Flowable], str]:
    cv_text = _clean_text(cv_text)
    rtl = _is_rtl_document(cv_text)
    raw_lines = [ln.rstrip() for ln in cv_text.splitlines()]
    raw_name, raw_role, raw_contact = _header_indices(raw_lines)
    lines = _reflow_lines(raw_lines, raw_name, raw_contact, raw_role)

    # The reflowed header keeps raw order: name, then role, then contact.
    header_count = sum(1 for i in (raw_name, raw_role, raw_contact) if i is not None)
    header_lines = lines[:header_count]
    name = header_lines[0] if header_lines else ""
    role = header_lines[1] if raw_role is not None else None
    contact = header_lines[-1] if raw_contact is not None else None

    # Headings not in CANONICAL_SECTIONS (e.g. "Hackathons") still get the
    # heading treatment if the line looks heading-shaped AND is immediately
    # followed by a bullet or role header — otherwise a short sentence could
    # be mistaken for one.
    # The line straight under a role header is its company or location
    # ("Tel Aviv", "תל אביב"), never a heading.
    body_lines = lines[header_count:]
    heading_idxs = set()
    for idx, ln in enumerate(body_lines):
        if _is_section_header(ln) or (
            not _is_bullet(ln)
            and _is_bare_heading_candidate(ln)
            and not (idx > 0 and _is_role_header(body_lines[idx - 1]))
            and idx + 1 < len(body_lines)
            and (_is_bullet(body_lines[idx + 1]) or _is_role_header(body_lines[idx + 1]))
        ):
            heading_idxs.add(idx)
    body = _order_sections(body_lines, heading_idxs)

    story: list[Flowable] = []
    if name:
        story.append(_single_line(name, "PS-Bold", 26, 26 * 1.05, INK, rtl, tracking_em=-0.025))
    if role:
        story.append(Spacer(1, 5))
        story.append(_single_line(role, "PS-Medium", 12, 15, ACCENT, rtl))
    if contact:
        parts = [p.strip() for p in contact.split("|") if p.strip()] or [contact]
        story.append(Spacer(1, 7))
        if rtl or _has_hebrew(contact):
            sep = _Run("\u00a0\u00a0|\u00a0\u00a0", "PS-Regular", 9, CONTACT)
            runs: list[_Run] = []
            for i, part in enumerate(parts):
                if i:
                    runs.append(sep)
                runs += _style_runs(part, _CONTACT_STYLE, label=False)
            story.append(_BidiParagraph(runs, _CONTACT_STYLE.leading, rtl))
        else:
            story.append(Paragraph("&#160;&#160;|&#160;&#160;".join(_linkify(p) for p in parts), _CONTACT_STYLE))
    if story:
        story.append(HRFlowable(
            width="100%", thickness=2, color=ACCENT, lineCap="butt",
            spaceBefore=spacing.rule_before, spaceAfter=spacing.rule_after,
        ))

    # Group the body into sections of entries, then lay them out. A section
    # is (label as printed, canonical kind or None, entries).
    sections: list[tuple[str | None, str | None, list[_Entry]]] = []
    for line, is_heading in body:
        if is_heading:
            label = _canonical_section_text(line) if _is_section_header(line) else line.rstrip(":")
            sections.append((label, _section_kind(line), []))
            continue
        if not sections:
            sections.append((None, None, []))
        _, kind, entries = sections[-1]

        if _is_role_header(line) and kind != "Summary":
            title, date = _split_role_header(line)
            header = (
                _BidiEntryHeader(title, date, rtl) if rtl or _has_hebrew(title + date) else _EntryHeader(title, date)
            )
            entries.append(_Entry(header, []))
            continue

        if _is_bullet(line):
            text = re.sub(r"^[-•*o○●]\s+", "", line)
            flowable = _text_flowable(text, _BULLET_STYLE, rtl, label=True, prefix=_BULLET_PREFIX)
        elif kind == "Summary":
            flowable = _text_flowable(line, _SUMMARY_STYLE, rtl, label=False)
        elif entries and entries[-1].header is not None and not entries[-1].lines and not _is_label_line(line):
            # The line straight under a role header with no bullet yet — a
            # company/location or degree subtitle: secondary.
            flowable = _text_flowable(line, _SECONDARY_STYLE, rtl, label=False)
        else:
            flowable = _text_flowable(line, _BODY_STYLE, rtl, label=True)

        if entries and entries[-1].header is not None:
            entries[-1].lines.append(flowable)
        else:
            entries.append(_Entry(None, [flowable]))

    for s_idx, (label, _kind, entries) in enumerate(sections):
        chunks: list[list[Flowable]] = []
        for e_idx, entry in enumerate(entries):
            entry_chunks = _entry_chunks(entry)
            if e_idx > 0 and entry.header is not None and entry_chunks:
                entry_chunks[0].insert(0, Spacer(1, spacing.role))
            chunks.extend(entry_chunks)
        lead: list[Flowable] = []
        if s_idx > 0:
            lead.append(Spacer(1, spacing.section))
        if label:
            lead += [
                _single_line(label.upper(), "PS-Label", 8.5, 11, ACCENT, rtl),
                Spacer(1, spacing.label_after),
            ]
        # A section label never ends a page: it travels with its first chunk.
        first = lead + (chunks[0] if chunks else [])
        story.append(KeepTogether(first))
        story.extend(KeepTogether(c) if len(c) > 1 else c[0] for c in chunks[1:])

    if not story:
        story.append(Spacer(1, 0))
    return story, name


def _render(cv_text: str, spacing: _Spacing) -> tuple[bytes, int]:
    story, name = _build_story(cv_text, spacing)
    buf = BytesIO()
    doc = BaseDocTemplate(
        buf,
        pagesize=_PAGE_SIZE,
        leftMargin=_MARGIN_SIDE,
        rightMargin=_MARGIN_SIDE,
        topMargin=_MARGIN_TOP,
        bottomMargin=_MARGIN_BOTTOM,
        title=name or "CV",
        author=name,
    )
    # No frame padding: SimpleDocTemplate's frame adds 6pt inside every
    # margin, which made them 72pt at the sides, 66 top and 60 bottom until
    # 2026-11-25 instead of the design's 66 / 60 / 54.
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="cv",
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="cv", frames=[frame])])
    doc.build(story)
    return buf.getvalue(), doc.page


def generate_cv_pdf(cv_text: str) -> bytes:
    """Render an AI-authored CV (plain text) into a designed, ATS-parseable PDF.

    Spacing is fixed — a short CV ends partway down the page rather than
    having its gaps stretched. The one exception: when content spills onto
    an extra page, the vertical gaps are tightened (never the type) and that
    version is used if it saves the page.

    Never call this on a user's uploaded CV — an upload must be sent
    byte-for-byte, not re-rendered. See CV.source in prisma/schema.prisma.

    Raises UnsupportedScriptError when the CV has letters neither embedded
    font covers (Hebrew is covered) — never a PDF with boxes in it.
    """
    if missing := unsupported_characters(cv_text):
        raise UnsupportedScriptError(missing)
    pdf, pages = _render(cv_text, _NORMAL)
    if pages > 1:
        compact, compact_pages = _render(cv_text, _COMPACT)
        if compact_pages < pages:
            return compact
    return pdf


def resolve_cv_file(tailored_cv: str | None, cv_row: dict | None) -> tuple[bytes, str] | None:
    """Decide what CV file to attach/submit for an application, and return
    (file_bytes, filename) — or None if it can't be decided safely.
    Raises UnsupportedScriptError (generate_cv_pdf) when the text to render
    has letters the PDF can't set; callers stop the application for the user.

    - tailored_cv (Application.tailored_cv) is always Claude-authored — safe
      to render into the polished PDF.
    - Otherwise, cv_row is the user's CV table row. source='uploaded' with
      original_file present is a confirmed upload — sent byte-for-byte,
      never re-rendered. source='generated' is confirmed AI-authored text —
      safe to render.
    - Anything else — including every pre-migration row, which defaults to
      source='uploaded' with no original_file on file — is NOT rendered.
      We can't prove that raw_text isn't the user's own words (the column
      had no provenance tracking before this migration), so guessing wrong
      would silently violate the "never re-render an upload" rule. Callers
      must treat None as needs_manual/needs-reupload, not a silent failure.
    """
    if tailored_cv:
        return generate_cv_pdf(tailored_cv), "cv.pdf"

    if not cv_row:
        return None

    if cv_row.get("source") == "uploaded":
        if cv_row.get("original_file"):
            filename = cv_row.get("original_filename") or "cv.pdf"
            return bytes(cv_row["original_file"]), filename
        return None

    if cv_row.get("source") == "generated" and cv_row.get("raw_text"):
        return generate_cv_pdf(cv_row["raw_text"]), "cv.pdf"

    return None
