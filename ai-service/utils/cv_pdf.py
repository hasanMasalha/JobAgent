import re
from io import BytesIO
from xml.sax.saxutils import escape as _raw_xml_escape

from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer

# ── design tokens ──────────────────────────────────────────────────────────
# One accent colour (deep navy), used only for the name, section headings and
# rules — everything else stays near-black/grey. Core PDF fonts (Helvetica)
# so rendering never depends on a font being installed on the server.
ACCENT_NAVY = "#1B3A5C"
TEXT_PRIMARY = "#1F2937"   # role/school titles (bold)
TEXT_BODY = "#374151"      # paragraph and bullet text
TEXT_MUTED = "#6B7280"     # contact line, role dates
LINK_COLOR = "#1D4ED8"

_PAGE_SIZE = A4
_MARGIN = 0.85 * inch

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

# reportlab's core (non-embedded) fonts don't emit a working ToUnicode CMap
# for punctuation outside plain ASCII — text extracts fine visually but comes
# back as U+FFFD replacement chars for a parser. Normalize to ASCII
# equivalents up front so what an ATS extracts matches what's on the page.
_ASCII_REPLACEMENTS = {
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", "•": "-", "·": "-",
    "‣": "-", "●": "-", "○": "-", "…": "...", " ": " ",
}


def _ascii_safe(text: str) -> str:
    for src, dst in _ASCII_REPLACEMENTS.items():
        text = text.replace(src, dst)
    return text


def _xml_escape(text: str) -> str:
    """Escape for reportlab paragraph markup AND sanitize to ASCII.

    Structure detection (bullets, section headers, role-header separators
    and dates) runs on the original text, since normalizing first would
    erase the very punctuation (en-dashes, bullet marks) those heuristics
    look for. Sanitization happens here instead — at the point each fragment
    is actually rendered — so detection still sees the real characters while
    the page only ever contains ones reportlab's core fonts round-trip
    cleanly through text extraction.
    """
    return _raw_xml_escape(_ascii_safe(text))


_MONTH = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?"
_DATE_TOKEN = rf"(?:{_MONTH}\s+)?\d{{4}}"
_DATE_RANGE_RE = re.compile(
    rf"\(?\s*({_DATE_TOKEN}|Present|Current)\s*[-–—]\s*({_DATE_TOKEN}|Present|Current|Now)\s*\)?\s*$",
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


def _linkify(line: str, color: str) -> str:
    """Return reportlab mini-XML markup with recognized URLs/emails as <link> runs."""
    matches: list[tuple[int, int, str]] = []
    for pattern, build_url in _LINK_PATTERNS:
        for m in pattern.finditer(line):
            start, end = m.span()
            if any(start < e and end > s for s, e, _ in matches):
                continue
            matches.append((start, end, build_url(m)))
    if not matches:
        return _xml_escape(line)

    matches.sort(key=lambda t: t[0])
    out: list[str] = []
    pos = 0
    for start, end, url in matches:
        if start < pos:
            continue
        if start > pos:
            out.append(_xml_escape(line[pos:start]))
        display = _xml_escape(line[start:end])
        out.append(f'<link href="{_xml_escape(url)}" color="{color}"><u>{display}</u></link>')
        pos = end
    if pos < len(line):
        out.append(_xml_escape(line[pos:]))
    return "".join(out)


_LABEL_PREFIX_RE = re.compile(r"^([A-Za-z][A-Za-z0-9 /&+-]{0,30}:)\s*(.+)$")


def _is_label_line(line: str) -> bool:
    """'Languages: Python, SQL' — a "Label: values" line (skills by category etc.)."""
    return bool(_LABEL_PREFIX_RE.match(line.strip()))


def _bold_label_prefix(line: str) -> str | None:
    """'Languages: Python, SQL' -> bold the 'Languages:' label. None if no match."""
    m = _LABEL_PREFIX_RE.match(line)
    if not m:
        return None
    return f"<b>{_xml_escape(m.group(1))}</b> {_linkify(m.group(2), LINK_COLOR)}"


def _is_section_header(line: str) -> bool:
    return line.strip().rstrip(":").lower() in _CANONICAL_SECTIONS


def _canonical_section_text(line: str) -> str:
    key = line.strip().rstrip(":").lower()
    return _CANONICAL_SECTIONS.get(key, line.strip().rstrip(":").title())


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
    return all(w[0].isupper() for w in words if w[0].isalpha())


def _is_bullet(line: str) -> bool:
    return line.startswith(("- ", "• ", "* ", "o ", "○ ", "● "))


def _is_contact_line(line: str) -> bool:
    return "@" in line or "|" in line or "+" in line or bool(re.search(r"\d{3}", line))


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
    has_separator = any(sep in line for sep in ("·", "–", "—", "|")) or " at " in line.lower()
    # Anchored at end-of-line, not "any 4-digit number anywhere" — otherwise
    # a body sentence like "(2000+ GitHub stars)" false-positives as a date.
    has_trailing_date = bool(_DATE_RANGE_RE.search(line) or _SINGLE_DATE_RE.search(line))
    return has_separator or has_trailing_date


def _reflow_lines(raw_lines: list[str], name_idx: int | None, contact_idx: int | None) -> list[str]:
    """Merge hard line-wraps from the source PDF/DOCX text extraction back
    into logical lines. Extracted text commonly hard-breaks mid-sentence at
    wherever the original document happened to wrap — without this, a
    bullet's wrapped continuation renders as its own orphaned, unindented
    paragraph instead of flowing under the bullet it belongs to. A line
    starts a new logical line if it looks like a bullet/heading/role header,
    or if the previous logical line already looks "closed" (ends in
    sentence-terminal punctuation); otherwise it's appended to the previous
    one. name/contact lines are never a merge source or target."""
    protected = (1 if name_idx is not None else 0) + (1 if contact_idx is not None else 0)
    result: list[str] = []
    for i, raw in enumerate(raw_lines):
        line = raw.strip()
        if not line:
            continue
        if i == name_idx or i == contact_idx:
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
        if not starts_new_block and len(result) > protected:
            prev = result[-1]
            prev_is_open = not prev.rstrip().endswith((".", "!", "?", ":")) and not _is_section_header(prev)
            if prev_is_open:
                result[-1] = f"{prev} {line}"
                continue
        result.append(line)
    return result


# Canonical section order, applied by the renderer rather than trusted to the
# AI's output. Other canonical sections (Certifications, Languages, ...) follow
# Skills; unrecognized headings ("Hackathons") go last. Ties keep input order.
_SECTION_ORDER = {"Summary": 0, "Experience": 1, "Projects": 2, "Education": 3, "Skills": 4}
_OTHER_CANONICAL_RANK = 5
_NONSTANDARD_RANK = 6


def _section_rank(heading: str) -> int:
    if not _is_section_header(heading):
        return _NONSTANDARD_RANK
    return _SECTION_ORDER.get(_canonical_section_text(heading), _OTHER_CANONICAL_RANK)


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


def generate_cv_pdf(cv_text: str) -> bytes:
    """Render an AI-authored CV (plain text) into a polished, ATS-parseable PDF.

    Never call this on a user's uploaded CV — an upload must be sent
    byte-for-byte, not re-rendered. See CV.source in prisma/schema.prisma.
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=_PAGE_SIZE,
        leftMargin=_MARGIN,
        rightMargin=_MARGIN,
        topMargin=_MARGIN,
        bottomMargin=_MARGIN,
    )

    name_style = ParagraphStyle(
        "CVName", fontName="Helvetica-Bold", fontSize=22, leading=26,
        textColor=ACCENT_NAVY, alignment=TA_CENTER, spaceAfter=4,
    )
    contact_style = ParagraphStyle(
        "CVContact", fontName="Helvetica", fontSize=9.5, leading=13,
        textColor=TEXT_MUTED, alignment=TA_CENTER, spaceAfter=14,
    )
    heading_style = ParagraphStyle(
        "CVHeading", fontName="Helvetica-Bold", fontSize=12, leading=15,
        textColor=ACCENT_NAVY, alignment=TA_LEFT, spaceBefore=14, spaceAfter=2,
    )
    role_style = ParagraphStyle(
        "CVRole", fontName="Helvetica-Bold", fontSize=10.5, leading=14,
        textColor=TEXT_PRIMARY, alignment=TA_LEFT, spaceBefore=8, spaceAfter=1,
    )
    body_style = ParagraphStyle(
        "CVBody", fontName="Helvetica", fontSize=10, leading=14,
        textColor=TEXT_BODY, alignment=TA_LEFT, spaceAfter=4,
    )
    bullet_style = ParagraphStyle(
        "CVBullet", fontName="Helvetica", fontSize=10, leading=14,
        textColor=TEXT_BODY, alignment=TA_LEFT, spaceAfter=3,
        leftIndent=14, bulletIndent=0,
    )

    story = []
    raw_lines = [ln.rstrip() for ln in cv_text.splitlines()]
    raw_non_empty = [i for i, ln in enumerate(raw_lines) if ln.strip()]

    raw_name_idx = raw_non_empty[0] if raw_non_empty else None
    raw_contact_idx = None
    if raw_name_idx is not None:
        rest = [i for i in raw_non_empty if i > raw_name_idx]
        if rest and (rest[0] == raw_name_idx + 1 or _is_contact_line(raw_lines[rest[0]])):
            raw_contact_idx = rest[0]

    lines = _reflow_lines(raw_lines, raw_name_idx, raw_contact_idx)
    name_idx = 0 if lines else None
    contact_idx = 1 if (raw_contact_idx is not None and len(lines) > 1) else None

    # Headings not in CANONICAL_SECTIONS (e.g. "Hackathons") still get the
    # heading treatment if the line looks heading-shaped AND is immediately
    # followed by a bullet or role header — otherwise a short sentence could
    # be mistaken for one.
    bare_headings: set[int] = set()
    for idx, ln in enumerate(lines):
        if idx in (name_idx, contact_idx):
            continue
        if _is_section_header(ln) or _is_bullet(ln) or not _is_bare_heading_candidate(ln):
            continue
        if idx + 1 >= len(lines):
            continue
        if _is_bullet(lines[idx + 1]) or _is_role_header(lines[idx + 1]):
            bare_headings.add(idx)

    header_count = (1 if name_idx is not None else 0) + (1 if contact_idx is not None else 0)
    heading_idxs = {
        i - header_count
        for i, ln in enumerate(lines)
        if i >= header_count and (_is_section_header(ln) or i in bare_headings)
    }
    body = _order_sections(lines[header_count:], heading_idxs)

    # A heading is never emitted directly — it's held as "pending" until the
    # next flowable is built, then both are wrapped in one KeepTogether, so
    # reportlab's automatic page-breaking can never strand a heading alone
    # at the bottom of a page with its content pushed to the next one.
    pending_heading: list = []

    def _emit(flowable: Paragraph) -> None:
        nonlocal pending_heading
        if pending_heading:
            story.append(KeepTogether(pending_heading + [flowable]))
            pending_heading = []
        else:
            story.append(flowable)

    if name_idx is not None:
        _emit(Paragraph(_xml_escape(lines[name_idx]), name_style))
    if contact_idx is not None:
        line = lines[contact_idx]
        parts = [p.strip() for p in line.split("|") if p.strip()]
        contact_markup = f' <font color="{TEXT_MUTED}">|</font> '.join(_linkify(p, LINK_COLOR) for p in parts) if parts else _linkify(line, LINK_COLOR)
        _emit(Paragraph(contact_markup, contact_style))

    for line, is_heading in body:
        if is_heading:
            if pending_heading:
                # Two headings back-to-back (malformed input) — flush the
                # first alone rather than lose it.
                story.append(KeepTogether(pending_heading))
            heading_text = _canonical_section_text(line) if _is_section_header(line) else line.rstrip(":")
            heading_para = Paragraph(_xml_escape(heading_text.upper()), heading_style)
            rule = HRFlowable(width="100%", thickness=0.75, color=ACCENT_NAVY, spaceBefore=2, spaceAfter=6)
            pending_heading = [heading_para, rule]
            continue

        if _is_bullet(line):
            text = re.sub(r"^[-•*o○●]\s+", "", line)
            labeled = _bold_label_prefix(text)
            markup = labeled if labeled else _linkify(text, LINK_COLOR)
            _emit(Paragraph(f"-  {markup}", bullet_style))
            continue

        if _is_role_header(line):
            left, date = _split_role_header(line)
            markup = _xml_escape(left)
            if date:
                # Date inline right after the title, not right-aligned: a wide
                # gap makes text extractors (and so ATS parsers) treat the date
                # as a separate column and attach it to the wrong line.
                # face="Helvetica" resets weight — role_style's base font is
                # Bold, and <font> alone only changes color.
                markup += f' <font face="Helvetica" color="{TEXT_MUTED}">| {_xml_escape(date)}</font>'
            _emit(Paragraph(markup, role_style))
            continue

        labeled = _bold_label_prefix(line)
        _emit(Paragraph(labeled if labeled else _linkify(line, LINK_COLOR), body_style))

    if pending_heading:
        story.append(KeepTogether(pending_heading))

    if not story:
        story.append(Spacer(1, 0))

    doc.build(story)
    return buf.getvalue()


def resolve_cv_file(tailored_cv: str | None, cv_row: dict | None) -> tuple[bytes, str] | None:
    """Decide what CV file to attach/submit for an application, and return
    (file_bytes, filename) — or None if it can't be decided safely.

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
