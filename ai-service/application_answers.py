"""What an ATS application may answer, and with what.

The rule (decided 2026-10-04, the same as the extension's for facts):
- A factual or eligibility question is answered only with something the user
  gave us: a Profile field, or an answer they saved for that exact question.
  No defaults. These forms are submitted with no review step, so a guessed
  answer is a false statement made in the user's name.
- Claude may write the answer to an open-ended free-text question ("Why do
  you want to work here?"), grounded in the CV.
- A required question with neither is not answered, and the application is
  not submitted (needs_manual, credit refunded).

The Profile matching mirrors chrome-extension/answers.js, including its
limits: a Profile field answers only the question it was asked as. Profile
asks "Authorized to work in Israel?" and "Expected salary (monthly, NIS)", so
those don't answer a UK work-authorisation or an annual salary question, and
total years don't answer "years of experience with React".

Until 2026-10-04 the ATS filler answered "2" years, work authorisation "Yes",
salary "Negotiable", notice "Immediate", current company "Self-employed",
"heard via LinkedIn", the first option of an unrecognised dropdown, and had
Claude answer anything else.
"""
import re
from dataclasses import dataclass, field


@dataclass
class ApplicantData:
    """The user's own answers. None means the user hasn't given one."""

    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    city: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    portfolio_url: str | None = None
    current_company: str | None = None
    expected_salary: str | None = None  # monthly, NIS (Profile)
    # The six "Application details": only once the user has confirmed them
    # (application_details_confirmed_at) — they once had database defaults.
    notice_period: str | None = None
    years_of_experience: str | None = None  # total
    highest_education: str | None = None
    work_authorized: bool | None = None  # in Israel
    requires_sponsorship: bool | None = None
    willing_to_relocate: bool | None = None
    # Normalised question -> the answer the user typed for it before.
    saved_answers: dict[str, str] = field(default_factory=dict)

    @property
    def full_name(self) -> str | None:
        if self.first_name and self.last_name:
            return f"{self.first_name} {self.last_name}"
        return None

    @classmethod
    def from_row(cls, row: dict, saved: list[tuple[str, str]] | None = None) -> "ApplicantData":
        """From a "User" row (and its EasyApplyAnswer rows), applying the
        confirmation rule for the six Application details."""
        confirmed = bool(row.get("application_details_confirmed_at"))

        def text(key):
            v = row.get(key)
            v = str(v).strip() if v is not None else ""
            return v or None

        def flag(key):
            v = row.get(key)
            return v if isinstance(v, bool) else None

        return cls(
            first_name=text("first_name"),
            last_name=text("last_name"),
            email=text("email"),
            phone=text("phone"),
            city=text("city"),
            linkedin_url=text("linkedin_url"),
            github_url=text("github_url"),
            portfolio_url=text("portfolio_url"),
            current_company=text("currentCompany"),
            expected_salary=text("expected_salary"),
            notice_period=text("notice_period") if confirmed else None,
            years_of_experience=text("years_of_experience") if confirmed else None,
            highest_education=text("highest_education") if confirmed else None,
            work_authorized=flag("work_authorized") if confirmed else None,
            requires_sponsorship=flag("requires_sponsorship") if confirmed else None,
            willing_to_relocate=flag("willing_to_relocate") if confirmed else None,
            saved_answers={normalize(q): a.strip() for q, a in (saved or []) if a and a.strip()},
        )


def normalize(label: str | None) -> str:
    return " ".join((label or "").lower().split()).rstrip(" *")


def _any(label: str, words) -> bool:
    return any(w in label for w in words)


def saved_answer(label: str, data: ApplicantData) -> str | None:
    """The user's saved answer for this exact question."""
    return data.saved_answers.get(normalize(label)) or None


def text_answer(label: str, data: ApplicantData) -> str | None:
    """A text / number / URL / dropdown answer from the user's Profile.
    None when the user hasn't given one (or it isn't the question the Profile
    field was asked as). Mirrors jaAnswerForLabel in answers.js."""
    lab = normalize(label)
    if not lab:
        return None

    if "first name" in lab:
        return data.first_name
    if _any(lab, ("last name", "family name", "surname")):
        return data.last_name
    if "full name" in lab or lab == "name":
        return data.full_name
    if _any(lab, ("phone", "mobile", "telephone")):
        return data.phone
    if "email" in lab:
        return data.email
    if re.search(r"\bcity\b", lab) or lab == "location" or "current location" in lab:
        return data.city

    if "linkedin" in lab:
        return data.linkedin_url
    if "github" in lab:
        return data.github_url
    if _any(lab, ("portfolio", "website", "personal site")):
        return data.portfolio_url

    if _any(lab, ("current company", "current employer", "most recent company",
                  "recent employer", "current or most recent")):
        return data.current_company

    # Salary: the Profile figure is monthly, in NIS.
    if _any(lab, ("salary", "compensation", "wage", "ctc", "שכר")):
        monthly_nis = _any(lab, ("month", "nis", "ils", "₪", "שכר", "חודשי"))
        other_basis = _any(lab, ("annual", "year", "hour", "usd", "$", "eur", "€", "gbp", "£"))
        return data.expected_salary if monthly_nis and not other_basis else None

    if _any(lab, ("notice period", "הודעה מוקדמת")):
        return data.notice_period

    # Total experience only.
    if _any(lab, ("years of work experience", "years of professional experience",
                  "total years of experience", "total experience", "overall experience",
                  "שנות ניסיון")) and not re.search(
        r"\b(with|in|using)\b", re.sub(r"years? of (work|professional) experience", "", lab)
    ):
        return data.years_of_experience

    if _any(lab, ("highest level of education", "highest education", "level of education", "השכלה")):
        return data.highest_education

    return None


def boolean_answer(label: str, data: ApplicantData) -> bool | None:
    """Yes / no from the user's Profile, or None. Mirrors jaBooleanAnswer."""
    lab = normalize(label)
    if _any(lab, ("sponsor", "ויזה", "חסות")) or ("visa" in lab and "authoriz" not in lab):
        return data.requires_sponsorship
    if _any(lab, ("authorized", "authorised", "authorization", "eligible to work", "right to work",
                  "legally", "work permit", "מורשה", "רשאי")) and _any(lab, ("israel", "ישראל")):
        return data.work_authorized
    if _any(lab, ("relocat", "willing to move", "מעבר דירה")):
        return data.willing_to_relocate
    return None


def user_answer(label: str, data: ApplicantData) -> str | None:
    """The user's answer to a question, as text: a saved answer for this exact
    question first, then a Profile field. Yes/No for a Profile boolean."""
    saved = saved_answer(label, data)
    if saved:
        return saved
    text = text_answer(label, data)
    if text:
        return text
    flag = boolean_answer(label, data)
    if flag is not None:
        return "Yes" if flag else "No"
    return None


def match_option(options: list[str], answer: str | None) -> int:
    """Index of the option that is this answer, or -1. Ambiguous partial
    matches ("no" also in "not sure") are no match. Mirrors jaMatchOption."""
    want = normalize(answer)
    if not want:
        return -1
    texts = [normalize(o) for o in options]
    if want in texts:
        return texts.index(want)
    partial = [i for i, t in enumerate(texts) if t and (want in t or t in want)]
    return partial[0] if len(partial) == 1 else -1


# ── Claude, for open-ended free text only ──────────────────────────────────

# Questions that are facts, eligibility or legal statements: never Claude.
# Matched at the start of a word, so "age" isn't found in "manage".
_FACTUAL = (
    "years", "how many", "how long", "salary", "compensation", "pay", "rate",
    "notice", "start date", "available", "availability", "when can you",
    "authoriz", "authoris", "eligible", "right to work", "visa", "sponsor", "citizen",
    "clearance", "relocat", "located", "location", "based", "reside", "live in",
    "address", "country", "city", "time zone", "timezone", "hybrid", "on-site", "onsite",
    "remote", "commute", "travel", "hear about", "heard about", "how did you find",
    "referr", "referred", "who referred", "current company", "employer", "title",
    "degree", "education", "gpa", "university", "graduat", "certif", "license",
    "criminal", "convict", "background check", "drug", "terminated", "fired",
    "non-compete", "non compete", "worked for", "previously applied", "employed by",
    "gender", "race", "ethnic", "veteran", "disab", "pronoun", "age", "date of birth",
    "phone", "email", "linkedin", "github", "website", "portfolio", "url", "link",
    "name", "language", "fluent", "speak",
)
# What an open-ended question asks for.
_OPEN_ENDED = (
    "why", "what excites", "what interests", "what draws", "what attracted",
    "tell us", "tell me", "describe", "motivat", "interest you", "interested in",
    "about yourself", "about you", "what makes you", "what would you", "how would you",
    "anything else", "additional information", "share", "excited", "passion",
    "what do you", "cover letter", "proud", "challenge",
)


_FACTUAL_RE = re.compile(r"\b(?:" + "|".join(re.escape(w) for w in _FACTUAL) + ")")
_OPEN_ENDED_RE = re.compile(r"\b(?:" + "|".join(re.escape(w) for w in _OPEN_ENDED) + ")")


def claude_may_answer(label: str, is_long_text: bool) -> bool:
    """Whether Claude may write this answer: an open-ended question in a
    free-text field, and not a fact the user has to give."""
    lab = normalize(label)
    if not is_long_text or not lab:
        return False
    if _FACTUAL_RE.search(lab):
        return False
    return bool(_OPEN_ENDED_RE.search(lab))


# Consent to process the application's personal data: inherent in applying,
# not a statement of fact. Narrow on purpose — background-check consent,
# drug-test policies and arbitration terms are not this.
def is_data_processing_consent(label: str) -> bool:
    lab = normalize(label)
    return _any(lab, ("privacy", "gdpr", "data protection", "personal data", "processing of my data"))


def is_decline_option(option: str) -> bool:
    """A "decline to self-identify" option on an EEO question — the honest
    choice when the user hasn't told us."""
    o = normalize(option)
    return _any(o, ("decline", "prefer not", "don't wish", "do not wish", "rather not", "not to answer", "not to disclose"))
