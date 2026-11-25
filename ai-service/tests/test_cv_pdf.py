import fitz
import pytest

from utils.cv_pdf import (
    _COMPACT,
    _NORMAL,
    UnsupportedScriptError,
    _header_indices,
    _is_bare_heading_candidate,
    _is_role_header,
    _reflow_lines,
    _render,
    _split_role_header,
    generate_cv_pdf,
    resolve_cv_file,
    unsupported_characters,
)

SHUFFLED_CV = """Jordan Levi
jordan.levi@example.com | +972 50 123 4567

Technical Skills
Languages: Python, TypeScript, SQL, Go
Infrastructure: AWS, Docker, Kubernetes, Terraform
Data: PostgreSQL, pgvector, Kafka, Redis

Hackathons
- 1st place, TAU Hack 2019

Education
B.Sc. Computer Science, Tel Aviv University | 2016 - 2020
- Graduated with honors

Certifications
- AWS Solutions Architect

Work Experience
Senior Backend Engineer, Acme Analytics | Jan 2023 - Present
- Designed a Kafka-based ingestion pipeline

Professional Summary
Backend engineer with 5 years building data pipelines.

Personal Projects
- jobscout: open-source job scraper
"""


def _page_lines(pdf: bytes) -> list[str]:
    text = fitz.open(stream=pdf, filetype="pdf")[0].get_text()
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def test_reflow_keeps_label_lines_separate():
    raw = ["Name", "a@b.com", "Skills", "Languages: Python, Go", "Data: PostgreSQL,", "Redis, Kafka"]
    lines = _reflow_lines(raw, 0, 1)
    assert lines[3:] == ["Languages: Python, Go", "Data: PostgreSQL, Redis, Kafka"]


def test_sections_rendered_in_canonical_order():
    lines = _page_lines(generate_cv_pdf(SHUFFLED_CV))
    headings = [ln for ln in lines if ln.isupper() and ln.isalpha()]
    assert headings == ["SUMMARY", "EXPERIENCE", "EDUCATION", "SKILLS", "PROJECTS", "CERTIFICATIONS", "HACKATHONS"]
    # Body travels with its heading.
    assert lines[lines.index("SUMMARY") + 1] == "Backend engineer with 5 years building data pipelines."


def test_role_date_extracts_on_same_line_as_title():
    # The date is right-aligned, but the gap is one stretched space glyph, so
    # extractors keep it on the title's line instead of filing it elsewhere.
    lines = _page_lines(generate_cv_pdf(SHUFFLED_CV))
    assert "Senior Backend Engineer, Acme Analytics Jan 2023 - Present" in lines
    assert "B.Sc. Computer Science, Tel Aviv University 2016 - 2020" in lines


def test_tracked_labels_and_bullets_extract_as_text():
    # 0.18em tracking drawn as character spacing extracts as "E X P E R ...";
    # a bullet drawn on its own extracts on a line of its own.
    lines = _page_lines(generate_cv_pdf(SHUFFLED_CV))
    assert "EXPERIENCE" in lines
    assert "• Designed a Kafka-based ingestion pipeline" in lines


def test_unicode_punctuation_survives_extraction():
    cv = "Dana Cohen\ndana@example.com\n\nSummary\nBuilt things — fast, “well” and ‘often’.\n"
    text = fitz.open(stream=generate_cv_pdf(cv), filetype="pdf")[0].get_text()
    assert "Built things — fast, “well” and ‘often’." in text
    assert "�" not in text


def test_every_line_is_set_in_embedded_public_sans():
    page = fitz.open(stream=generate_cv_pdf(SHUFFLED_CV), filetype="pdf")[0]
    span_fonts = {
        span["font"]
        for block in page.get_text("dict")["blocks"]
        for line in block.get("lines", [])
        for span in line["spans"]
        if span["text"].strip()
    }
    assert span_fonts and all("PublicSans" in f for f in span_fonts), span_fonts
    embedded = {f[3] for f in page.get_fonts() if f[1] == "ttf"}
    assert any("PublicSans" in f for f in embedded)


def test_role_line_only_when_the_cv_has_one():
    with_role = "Dana Cohen\nProduct Designer\ndana@example.com | +44 20 7946 0958\n\nSummary\nDesigner.\n"
    assert _page_lines(generate_cv_pdf(with_role))[:3] == [
        "Dana Cohen", "Product Designer", "dana@example.com  |  +44 20 7946 0958",
    ]
    without = "Dana Cohen\ndana@example.com | +44 20 7946 0958\n\nSummary\nDesigner.\n"
    assert _page_lines(generate_cv_pdf(without))[:3] == [
        "Dana Cohen", "dana@example.com  |  +44 20 7946 0958", "SUMMARY",
    ]
    # A headline with a pipe is still a headline, not the contact line.
    piped = "Dana Cohen\nDesigner | Design Systems\ndana@example.com\n\nSummary\nDesigner.\n"
    assert _header_indices(piped.splitlines()) == (0, 1, 2)


def test_summary_with_a_dash_is_not_a_job_title():
    assert not _is_role_header("Backend engineer with 5 years building pipelines — and APIs people like to use.")
    assert _is_role_header("Backend Engineer — Initech")
    assert _is_role_header("Backend Engineer, Initech 2020 - 2022")


def test_reflow_never_glues_text_onto_a_role_header():
    raw = ["Name", "a@b.com", "Education", "B.Sc. CS, TAU | 2016 - 2020", "Graduated with honors"]
    assert _reflow_lines(raw, 0, 1)[3:] == ["B.Sc. CS, TAU | 2016 - 2020", "Graduated with honors"]


def _cv_with_roles(n: int) -> str:
    roles = "".join(
        f"Engineer {k}, Firm {k} | {2000 + k} - {2001 + k}\n"
        "• Did a substantial piece of work that is described in a single fairly long line.\n"
        "• And a second thing.\n"
        for k in range(n)
    )
    return f"Dana Cohen\ndana@example.com\n\nExperience\n{roles}"


def test_one_role_fits_one_page_and_many_roles_flow_on():
    assert len(fitz.open(stream=generate_cv_pdf(_cv_with_roles(1)), filetype="pdf")) == 1
    doc = fitz.open(stream=generate_cv_pdf(_cv_with_roles(30)), filetype="pdf")
    assert len(doc) > 1
    # No page starts with a stranded bullet: each continues with a role header.
    for page in list(doc)[1:]:
        assert page.get_text().lstrip().startswith("Engineer ")


def test_tighter_spacing_is_used_only_when_it_saves_a_page():
    for n in range(1, 60):
        cv = _cv_with_roles(n)
        _, normal = _render(cv, _NORMAL)
        _, compact = _render(cv, _COMPACT)
        pages = len(fitz.open(stream=generate_cv_pdf(cv), filetype="pdf"))
        assert pages == min(normal, compact)
        if compact < normal:
            return
    raise AssertionError("no role count where tighter spacing saved a page")


def test_render_endpoint_returns_the_designed_pdf():
    from routes.cv import RenderCVRequest, render_cv_pdf

    res = render_cv_pdf(RenderCVRequest(cv_text=SHUFFLED_CV))
    assert res.media_type == "application/pdf"
    assert "EXPERIENCE" in _page_lines(res.body)


# ── Hebrew ──────────────────────────────────────────────────────────────────
# Public Sans has no Hebrew; Noto Sans Hebrew sets it, and a CV written
# mostly in Hebrew is laid out right to left.

HEBREW_CV = """דנה לוי
מפתחת Backend בכירה
dana@example.com | 050-123-4567 | תל אביב

כישורים
שפות תכנות: Python, Go, SQL

השכלה
B.Sc. במדעי המחשב, האוניברסיטה העברית | 2016

ניסיון תעסוקתי
מפתחת Backend בכירה, Wix | 03/2021 - היום
תל אביב
- הובלתי מעבר לענן שחסך 30% מעלויות התשתית.

תקציר
מפתחת Backend עם שמונה שנות ניסיון במערכות תשלומים.
"""

_PAGE_W = 595.27
_SIDE = 66


def _spans(pdf: bytes, page: int = 0) -> list[dict]:
    doc = fitz.open(stream=pdf, filetype="pdf")
    return [
        span
        for block in doc[page].get_text("dict")["blocks"]
        for line in block.get("lines", [])
        for span in line["spans"]
        if span["text"].strip()
    ]


def test_hebrew_is_set_in_embedded_noto_sans_hebrew():
    pdf = generate_cv_pdf(HEBREW_CV)
    fonts = {s["font"] for s in _spans(pdf)}
    assert any("NotoSansHebrew" in f for f in fonts), fonts
    assert all("NotoSansHebrew" in f or "PublicSans" in f for f in fonts), fonts
    text = fitz.open(stream=pdf, filetype="pdf")[0].get_text()
    # PyMuPDF reads display-order Hebrew back in reading order.
    for words in ("דנה לוי", "ניסיון תעסוקתי", "האוניברסיטה העברית"):
        assert words in text


def test_hebrew_cv_is_laid_out_right_to_left_in_canonical_order():
    spans = _spans(generate_cv_pdf(HEBREW_CV))
    name = next(s for s in spans if "דנה" in s["text"])  # the name's first word, at the right
    assert abs(name["bbox"][2] - (_PAGE_W - _SIDE)) < 2  # flush right
    label_words: dict[int, list[dict]] = {}
    for s in spans:
        if s["size"] < 9 and s["color"] == 0x2C5F7C:
            label_words.setdefault(round(s["bbox"][1]), []).append(s)
    # A label's words, read right to left.
    labels = [
        " ".join(w["text"].strip() for w in sorted(words, key=lambda w: -w["bbox"][0]))
        for _, words in sorted(label_words.items())
    ]
    assert labels == ["תקציר", "ניסיון תעסוקתי", "השכלה", "כישורים"]
    date = next(s for s in spans if "03/2021" in s["text"])
    assert date["bbox"][0] < _SIDE + 40  # the dates sit on the left
    bullet = next(s for s in spans if "•" in s["text"])
    assert bullet["bbox"][2] > _PAGE_W - _SIDE - 20  # the bullet hangs on the right


def test_hebrew_in_an_english_cv_keeps_it_left_to_right():
    cv = "Dana Levi\ndana@example.com\n\nEducation\nB.Sc. Computer Science, האוניברסיטה העברית | 2016\n"
    pdf = generate_cv_pdf(cv)
    spans = _spans(pdf)
    assert abs(next(s for s in spans if s["text"].startswith("Dana"))["bbox"][0] - _SIDE) < 2
    assert "האוניברסיטה העברית" in fitz.open(stream=pdf, filetype="pdf")[0].get_text()


def test_hebrew_dates_and_headings_are_recognised():
    assert _is_role_header("מפתחת Backend, Wix | 03/2021 - היום")
    assert _is_role_header("מפתח, Check Point | ינואר 2017 - פברואר 2021")
    assert _split_role_header("מפתחת, Wix | 03/2021 - עד היום") == ("מפתחת, Wix", "03/2021 - עד היום")
    assert _is_bare_heading_candidate("שירות צבאי")


def test_a_location_under_a_role_is_not_a_heading():
    cv = "Dana Cohen\ndana@example.com\n\nExperience\nEngineer, Acme | 2020 - 2022\nTel Aviv\n- Built it\n"
    lines = _page_lines(generate_cv_pdf(cv))
    assert "TEL AVIV" not in lines
    assert lines[lines.index("Tel Aviv") + 1] == "• Built it"


def test_long_hebrew_paragraphs_flow_across_pages():
    role = "מפתחת, חברה {k} | {a} - {b}\n" + "- " + "תיאור ארוך של עבודה משמעותית שנעשתה בתפקיד הזה " * 6 + "\n"
    cv = "דנה לוי\ndana@example.com\n\nניסיון תעסוקתי\n" + "".join(
        role.format(k=k, a=2000 + k, b=2001 + k) for k in range(25)
    )
    doc = fitz.open(stream=generate_cv_pdf(cv), filetype="pdf")
    assert len(doc) > 1
    text = "".join(page.get_text() for page in doc)
    assert all(str(2000 + k) in text for k in range(25))


def test_invisible_controls_and_points_are_dropped_not_boxed():
    cv = "דנה לוי\u200f\ndana@example.com\n\nתקציר\nמְפַתַּחַת Backend\u200e ✓\n"
    assert unsupported_characters(cv) == []
    text = fitz.open(stream=generate_cv_pdf(cv), filetype="pdf")[0].get_text()
    assert "מפתחת" in text and "✓" not in text


def test_a_script_neither_font_has_is_refused_not_boxed():
    cv = "Name\nname@example.com\n\nSummary\nمهندس برمجيات\n"
    with pytest.raises(UnsupportedScriptError):
        generate_cv_pdf(cv)
    from fastapi import HTTPException

    from routes.cv import RenderCVRequest, render_cv_pdf

    with pytest.raises(HTTPException) as exc:
        render_cv_pdf(RenderCVRequest(cv_text=cv))
    assert exc.value.status_code == 422 and exc.value.detail == "unsupported_script"
    assert resolve_cv_file_raises(cv)


def resolve_cv_file_raises(cv: str) -> bool:
    try:
        resolve_cv_file(cv, None)
    except UnsupportedScriptError:
        return True
    return False
