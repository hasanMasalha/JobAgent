import fitz

from utils.cv_pdf import _reflow_lines, generate_cv_pdf

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
    assert headings == ["SUMMARY", "EXPERIENCE", "PROJECTS", "EDUCATION", "SKILLS", "CERTIFICATIONS", "HACKATHONS"]
    # Body travels with its heading.
    assert lines[lines.index("SUMMARY") + 1] == "Backend engineer with 5 years building data pipelines."


def test_role_date_extracts_on_same_line_as_title():
    # Inline, not right-aligned: a right-aligned date gets split off into its
    # own column by text extractors and attached to the wrong line.
    lines = _page_lines(generate_cv_pdf(SHUFFLED_CV))
    assert "Senior Backend Engineer, Acme Analytics | Jan 2023 - Present" in lines
    assert "B.Sc. Computer Science, Tel Aviv University | 2016 - 2020" in lines
