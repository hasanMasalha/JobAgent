"""Answers for an application form, whoever fills it in.

The browser extension reads an ATS form's questions from the page and sends
them here; the server decides every answer with the same rules the server-
side fillers use (application_answers, phone_country). The extension only
fills in what comes back. The rules live in one place, in Python.

The rules, unchanged (see application_answers):
- A factual or eligibility question is answered only from the user's Profile
  or an answer they saved for that exact question. No defaults.
- Claude writes only open-ended free-text answers ("Why this company?"),
  grounded in the CV — never a select, yes/no or factual question.
- Voluntary EEO self-identification: "decline to self-identify" if it's
  required, otherwise left alone.
- Data-processing consent is the one box ticked for the user (not marketing,
  background checks or arbitration).
- A required question with no answer comes back in `missing`: the caller
  doesn't submit (needs_manual, credit refunded).

This generalises ashby_form.plan() to any ATS, given questions in one shape.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import anthropic

from application_answers import (
    ApplicantData,
    boolean_answer,
    claude_may_answer,
    is_data_processing_consent,
    is_decline_option,
    match_option,
    normalize,
    saved_answer,
    user_answer,
)
from phone_country import match_country_option, parse_phone

# What a question is, as the extension describes it.
KINDS = {
    "text", "long_text", "email", "phone", "number", "url",  # typed answers
    "select", "radio", "multi_select",                      # choose from options
    "boolean",                                              # yes / no
    "checkbox",                                             # one box: tick or not
    "location",                                             # city, with suggestions
    "phone_country",                                        # dial-code picker
    "file", "date",                                         # not answered (except the resume)
}
# A field the ATS itself names, so it isn't matched by its label.
ROLES = {"first_name", "last_name", "full_name", "email", "phone", "resume", "cover_letter"}


@dataclass
class Question:
    id: str                  # the extension's handle for the field
    label: str
    kind: str
    required: bool = False
    options: list[str] = field(default_factory=list)
    role: str | None = None  # one of ROLES
    eeo: bool = False        # voluntary self-identification survey

    @classmethod
    def from_dict(cls, d: dict) -> Question:
        kind = d.get("kind") if d.get("kind") in KINDS else "text"
        role = d.get("role") if d.get("role") in ROLES else None
        return cls(
            id=str(d.get("id") or ""),
            label=str(d.get("label") or "").strip(),
            kind=kind,
            required=bool(d.get("required")),
            options=[str(o) for o in (d.get("options") or []) if str(o).strip()],
            role=role,
            eeo=bool(d.get("eeo")),
        )


@dataclass
class Answer:
    id: str
    source: str                # profile | saved | consent | eeo_decline | cover_letter | phone_country | resume | claude
    value: str | None = None   # text to type; the city for "location"; "yes"/"no" for boolean / checkbox
    option: str | None = None  # the exact option label to choose (select / radio / phone_country)
    options: list[str] = field(default_factory=list)  # multi_select

    def to_dict(self) -> dict:
        d = {"id": self.id, "source": self.source}
        if self.value is not None:
            d["value"] = self.value
        if self.option is not None:
            d["option"] = self.option
        if self.options:
            d["options"] = self.options
        return d


def _source(label: str, applicant: ApplicantData) -> str:
    return "saved" if saved_answer(label, applicant) else "profile"


def plan_answers(
    questions: list[Question], applicant: ApplicantData, cover_letter: str = ""
) -> tuple[list[Answer], list[Question], list[Question]]:
    """(answers, questions for Claude, missing required questions).

    Pure: no page and no Claude call. A question in the second list may be
    answered by Claude; if Claude gives nothing and it's required, the caller
    adds it to missing.
    """
    answers: list[Answer] = []
    for_claude: list[Question] = []
    missing: list[Question] = []

    for q in questions:
        a = _answer(q, applicant, cover_letter)
        if a is not None:
            answers.append(a)
        elif q.kind == "long_text" and not q.eeo and claude_may_answer(q.label, is_long_text=True):
            for_claude.append(q)
        elif q.required:
            missing.append(q)
    return answers, for_claude, missing


def _answer(q: Question, applicant: ApplicantData, cover_letter: str) -> Answer | None:
    # Voluntary EEO: decline when it's required, otherwise leave it.
    if q.eeo:
        if not q.required:
            return None
        decline = next((o for o in q.options if is_decline_option(o)), None)
        return Answer(q.id, "eeo_decline", option=decline) if decline else None

    # Fields the ATS names itself.
    if q.role == "resume":
        return Answer(q.id, "resume")
    if q.role == "cover_letter":
        return Answer(q.id, "cover_letter", value=cover_letter) if cover_letter else None
    if q.role in ("first_name", "last_name", "full_name", "email", "phone"):
        value = {
            "first_name": applicant.first_name,
            "last_name": applicant.last_name,
            "full_name": applicant.full_name,
            "email": applicant.email,
            "phone": applicant.phone,
        }[q.role]
        return Answer(q.id, "profile", value=value) if value else None

    if q.kind == "phone_country":
        info = parse_phone(applicant.phone)
        idx = match_country_option(q.options, info) if info else -1
        return Answer(q.id, "phone_country", option=q.options[idx]) if idx != -1 else None

    if q.kind == "location":
        return Answer(q.id, "profile", value=applicant.city) if applicant.city else None

    if q.kind == "checkbox":
        # One box. Only data-processing consent is ticked for the user;
        # otherwise only an answer they saved for it.
        if is_data_processing_consent(q.label) and "marketing" not in q.label.lower():
            return Answer(q.id, "consent", value="yes")
        saved = saved_answer(q.label, applicant)
        if saved and normalize(saved) in ("yes", "no"):
            return Answer(q.id, "saved", value=normalize(saved))
        return None

    if q.kind == "boolean":
        saved = saved_answer(q.label, applicant)
        if saved and normalize(saved) in ("yes", "no"):
            return Answer(q.id, "saved", value=normalize(saved))
        flag = boolean_answer(q.label, applicant)
        return Answer(q.id, "profile", value="yes" if flag else "no") if flag is not None else None

    if q.kind in ("select", "radio", "multi_select"):
        if is_data_processing_consent(q.label):
            answer = "I agree"
            source = "consent"
        else:
            answer = user_answer(q.label, applicant)
            source = _source(q.label, applicant)
        idx = match_option(q.options, answer)
        if idx == -1:
            return None
        if q.kind == "multi_select":
            return Answer(q.id, source, options=[q.options[idx]])
        return Answer(q.id, source, option=q.options[idx])

    if q.kind in ("text", "long_text", "email", "phone", "number", "url"):
        answer = user_answer(q.label, applicant)
        if answer is not None:
            return Answer(q.id, _source(q.label, applicant), value=answer)
        if q.kind == "long_text" and cover_letter and "cover letter" in normalize(q.label):
            return Answer(q.id, "cover_letter", value=cover_letter)
        return None

    # file (other than the resume), date: not answered.
    return None


# ── Claude, for open-ended free text only ───────────────────────────────────

_claude = anthropic.Anthropic()
MAX_CLAUDE_ANSWERS = 5  # per application: a form with more open-ended questions stops for the user


async def claude_answer(question: str, cv_text: str) -> str | None:
    """Claude's answer to an OPEN-ENDED free-text question, grounded in the CV.
    Only for questions claude_may_answer() allows. None on failure."""
    prompt = (
        "You are writing one answer on a job application for a candidate. The "
        "question is open-ended; write a brief, professional answer (2-4 "
        "sentences) grounded only in what the CV below shows. Do not invent "
        "employers, titles, achievements, numbers or experience that aren't in "
        "the CV, and make no claims about eligibility, availability, salary or "
        "location. This is submitted without review under the candidate's "
        "name.\n\n"
        f"Question: {question}\n\n"
        f"CV:\n{(cv_text or '')[:3000]}\n\n"
        "Return ONLY the answer text — no explanation, no quotes, no markdown."
    )
    try:
        message = await asyncio.to_thread(
            _claude.messages.create,
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        answer = message.content[0].text.strip()
        return answer[:1500] or None
    except Exception as e:
        print(f"[answers] Claude answer failed for {question!r}: {e}")
        return None
