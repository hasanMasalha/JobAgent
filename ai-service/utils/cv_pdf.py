from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT

# Section headers to bold (case-insensitive match on stripped line)
_HEADER_KEYWORDS = {
    "summary", "objective", "profile",
    "work experience", "experience", "employment",
    "education", "academic",
    "skills", "technical skills", "competencies",
    "projects", "portfolio",
    "certifications", "certificates", "awards",
    "languages", "publications",
    "references",
}

_BODY_STYLE = ParagraphStyle(
    name="CVBody",
    fontName="Helvetica",
    fontSize=10,
    leading=14,
    alignment=TA_LEFT,
    wordWrap="LTR",
)

_HEADER_STYLE = ParagraphStyle(
    name="CVHeader",
    fontName="Helvetica-Bold",
    fontSize=12,
    leading=16,
    spaceBefore=8,
    alignment=TA_LEFT,
    wordWrap="LTR",
)

_NAME_STYLE = ParagraphStyle(
    name="CVName",
    fontName="Helvetica-Bold",
    fontSize=14,
    leading=18,
    spaceAfter=4,
    alignment=TA_LEFT,
    wordWrap="LTR",
)


def _is_section_header(line: str) -> bool:
    return line.strip().rstrip(":").lower() in _HEADER_KEYWORDS


def generate_cv_pdf(cv_text: str) -> bytes:
    """Convert CV plain text to a clean LTR PDF and return as bytes."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=inch,
        rightMargin=inch,
        topMargin=inch,
        bottomMargin=inch,
    )

    story = []
    lines = cv_text.splitlines()
    first_non_empty = True

    for line in lines:
        stripped = line.strip()
        if not stripped:
            story.append(Spacer(1, 4))
            continue

        if first_non_empty:
            # Treat the very first non-empty line as the candidate name
            story.append(Paragraph(stripped, _NAME_STYLE))
            first_non_empty = False
        elif _is_section_header(stripped):
            story.append(Paragraph(stripped.upper(), _HEADER_STYLE))
        else:
            # Escape any XML special chars so Paragraph doesn't choke
            safe = stripped.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            story.append(Paragraph(safe, _BODY_STYLE))

    doc.build(story)
    return buf.getvalue()
