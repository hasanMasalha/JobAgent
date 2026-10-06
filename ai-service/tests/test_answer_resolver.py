"""answer_resolver.plan_answers: the server decides every answer for a form
the extension fills, with the facts-only rules (application_answers)."""

import pytest

from answer_resolver import Question, plan_answers
from application_answers import ApplicantData

PROFILE = ApplicantData(
    first_name="Dana",
    last_name="Levi",
    email="dana@example.com",
    phone="+972 50-234-5678",
    city="Tel Aviv",
    linkedin_url="https://linkedin.com/in/dana",
    expected_salary="25000",
    years_of_experience="6",
    work_authorized=True,
    requires_sponsorship=False,
    saved_answers={"how did you hear about this opportunity?": "A friend"},
)


def q(**kw) -> Question:
    kw.setdefault("id", kw.get("label", "x"))
    return Question.from_dict(kw)


def run(*questions, applicant=PROFILE, cover_letter=""):
    answers, for_claude, missing = plan_answers(list(questions), applicant, cover_letter)
    return {a.id: a for a in answers}, [x.id for x in for_claude], [x.id for x in missing]


def test_fields_the_ats_names_come_from_profile():
    answers, _, missing = run(
        q(id="fn", label="First Name", kind="text", role="first_name", required=True),
        q(id="em", label="Email", kind="email", role="email", required=True),
        q(id="cv", label="Resume/CV", kind="file", role="resume", required=True),
    )
    assert answers["fn"].value == "Dana"
    assert answers["em"].value == "dana@example.com"
    assert answers["cv"].source == "resume"
    assert missing == []


def test_a_named_field_the_user_left_empty_is_missing():
    _, _, missing = run(q(id="ph", label="Phone", kind="phone", role="phone", required=True),
                        applicant=ApplicantData(first_name="Dana"))
    assert missing == ["ph"]


def test_saved_answer_for_the_exact_question():
    answers, _, _ = run(q(id="h", label="How did you hear about this opportunity?", kind="text", required=True))
    assert (answers["h"].value, answers["h"].source) == ("A friend", "saved")


@pytest.mark.parametrize(
    "label",
    [
        "What is your expected annual salary in USD?",        # Profile is monthly NIS
        "Years of experience with React",                     # total years don't answer it
        "Are you authorized to work in the United Kingdom?",  # Profile is for Israel
        "What is your notice period?",                        # not given
    ],
)
def test_facts_the_user_hasnt_given_are_missing_never_guessed(label):
    answers, for_claude, missing = run(q(id="f", label=label, kind="text", required=True))
    assert "f" not in answers
    assert for_claude == []
    assert missing == ["f"]


def test_monthly_nis_salary_from_profile():
    answers, _, _ = run(q(id="s", label="Expected monthly salary (NIS)", kind="number"))
    assert answers["s"].value == "25000"


def test_select_picks_the_matching_option():
    answers, _, _ = run(q(id="a", label="Are you legally authorized to work in Israel?", kind="select",
                          options=["Yes", "No"], required=True))
    assert answers["a"].option == "Yes"


def test_select_without_a_matching_option_is_missing():
    _, _, missing = run(q(id="h", label="How did you hear about this opportunity?", kind="select",
                          options=["LinkedIn", "Indeed", "Company website"], required=True))
    assert missing == ["h"]


def test_boolean_from_profile_and_sponsorship():
    answers, _, _ = run(
        q(id="auth", label="Authorized to work in Israel?", kind="boolean"),
        q(id="visa", label="Will you require visa sponsorship?", kind="boolean"),
    )
    assert answers["auth"].value == "yes"
    assert answers["visa"].value == "no"


def test_only_data_processing_consent_is_ticked():
    answers, _, missing = run(
        q(id="gdpr", label="I consent to the processing of my personal data (privacy notice)", kind="checkbox", required=True),
        q(id="mkt", label="Send me marketing emails about future roles (privacy policy)", kind="checkbox"),
        q(id="bg", label="I consent to a background check", kind="checkbox", required=True),
    )
    assert answers["gdpr"].value == "yes" and answers["gdpr"].source == "consent"
    assert "mkt" not in answers
    assert missing == ["bg"]


def test_eeo_declines_only_when_required():
    options = ["Male", "Female", "Decline to self-identify"]
    answers, _, missing = run(
        q(id="g1", label="Gender", kind="select", options=options, eeo=True, required=True),
        q(id="g2", label="Race", kind="select", options=options, eeo=True),
        q(id="g3", label="Veteran status", kind="select", options=["Yes", "No"], eeo=True, required=True),
    )
    assert answers["g1"].option == "Decline to self-identify"
    assert "g2" not in answers and "g2" not in missing
    assert missing == ["g3"]


def test_phone_country_by_name_and_dial_code():
    options = ["United States +1", "Israel +972", "United Kingdom +44"]
    answers, _, _ = run(q(id="pc", label="Country", kind="phone_country", options=options, required=True))
    assert answers["pc"].option == "Israel +972"


def test_phone_country_unplaceable_is_missing():
    _, _, missing = run(q(id="pc", label="Country", kind="phone_country", options=["Israel +972"], required=True),
                        applicant=ApplicantData(phone="07400 123456"))
    assert missing == ["pc"]


def test_open_ended_long_text_goes_to_claude_factual_long_text_does_not():
    _, for_claude, missing = run(
        q(id="why", label="Why do you want to work at Acme?", kind="long_text", required=True),
        q(id="yrs", label="How many years have you worked with Kubernetes?", kind="long_text", required=True),
        q(id="short", label="Why Acme?", kind="text", required=True),  # not free text: never Claude
    )
    assert for_claude == ["why"]
    assert missing == ["yrs", "short"]


def test_cover_letter_field_uses_the_applications_cover_letter():
    answers, for_claude, _ = run(
        q(id="cl", label="Cover Letter", kind="long_text"),
        q(id="clf", label="Cover letter", kind="file", role="cover_letter"),
        cover_letter="Dear team…",
    )
    assert answers["cl"].value == "Dear team…" and answers["cl"].source == "cover_letter"
    assert answers["clf"].value == "Dear team…"
    assert for_claude == []


def test_files_and_dates_are_not_answered():
    _, _, missing = run(
        q(id="port", label="Portfolio PDF", kind="file", required=True),
        q(id="start", label="Earliest start date", kind="date", required=True),
    )
    assert missing == ["port", "start"]


def test_unknown_kind_is_read_as_text():
    answers, _, _ = run(q(id="x", label="LinkedIn profile", kind="something-new"))
    assert answers["x"].value == "https://linkedin.com/in/dana"
