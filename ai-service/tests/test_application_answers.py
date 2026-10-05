"""ATS applications answer facts only from the user's own data (decided
2026-10-04). Until then the filler submitted "2" years, work authorisation
"Yes", salary "Negotiable", notice "Immediate", "Self-employed", "LinkedIn"
and the first option of any unrecognised dropdown."""
import pytest

from application_answers import (
    ApplicantData,
    boolean_answer,
    claude_may_answer,
    is_data_processing_consent,
    is_decline_option,
    match_option,
    text_answer,
    user_answer,
)

FULL = ApplicantData(
    first_name="Dana", last_name="Levi", email="dana@example.com", phone="+972501234567",
    city="Tel Aviv", linkedin_url="https://linkedin.com/in/dana", current_company="Acme",
    expected_salary="25000", notice_period="30", years_of_experience="6",
    highest_education="BSc", work_authorized=True, requires_sponsorship=False,
    willing_to_relocate=False,
    saved_answers={"how did you hear about this opportunity?": "A friend at the company"},
)
EMPTY = ApplicantData()


@pytest.mark.parametrize(
    "label",
    [
        "Years of professional experience",
        "Expected salary",
        "Notice period",
        "Current company",
        "How did you hear about this opportunity?",
        "Are you legally authorized to work in Israel?",
        "Will you require visa sponsorship?",
        "City",
    ],
)
def test_nothing_is_answered_without_the_users_data(label):
    assert user_answer(label, EMPTY) is None


def test_profile_and_saved_answers():
    assert user_answer("First Name *", FULL) == "Dana"
    assert user_answer("Name", FULL) == "Dana Levi"
    assert user_answer("Current company", FULL) == "Acme"
    assert user_answer("Total years of experience", FULL) == "6"
    assert user_answer("How did you hear about this opportunity?", FULL) == "A friend at the company"
    assert user_answer("Are you legally authorized to work in Israel?", FULL) == "Yes"
    assert user_answer("Will you now or in the future require visa sponsorship?", FULL) == "No"


@pytest.mark.parametrize(
    "label",
    [
        # Profile asks about Israel only.
        "Are you legally authorized to work in the United Kingdom?",
        "Do you have the right to work in the US?",
    ],
)
def test_work_authorisation_is_for_israel_only(label):
    assert boolean_answer(label, FULL) is None


@pytest.mark.parametrize(
    "label, expected",
    [
        ("Expected monthly salary (NIS)", "25000"),
        ("Expected salary (annual, USD)", None),
        ("What are your salary expectations per year?", None),
        ("Hourly rate", None),
    ],
)
def test_salary_is_monthly_nis_only(label, expected):
    assert text_answer(label, FULL) == expected


@pytest.mark.parametrize(
    "label",
    [
        "Years of experience with React",
        "Do you have a minimum of 7 years of experience building software?",
        "How many years of Python experience do you have?",
    ],
)
def test_total_years_dont_answer_a_specific_skill(label):
    assert text_answer(label, FULL) is None


def test_details_count_only_once_confirmed():
    row = {
        "first_name": "Dana", "years_of_experience": "6", "work_authorized": True,
        "notice_period": "30", "currentCompany": "Acme", "application_details_confirmed_at": None,
    }
    unconfirmed = ApplicantData.from_row(row)
    assert unconfirmed.years_of_experience is None
    assert unconfirmed.work_authorized is None
    assert unconfirmed.notice_period is None
    assert unconfirmed.current_company == "Acme"  # not one of the six
    confirmed = ApplicantData.from_row({**row, "application_details_confirmed_at": "2026-10-01"})
    assert confirmed.years_of_experience == "6" and confirmed.work_authorized is True


def test_saved_answers_match_regardless_of_case_and_spacing():
    data = ApplicantData.from_row({}, saved=[("How did you hear about us?", "Meetup")])
    assert user_answer("  How did you HEAR about us? * ", data) == "Meetup"


@pytest.mark.parametrize(
    "label",
    [
        "What excites you about Lumai?",
        "Why do you want to work at Notion?",
        "Tell us about a project you are proud of",
        "Describe your experience with distributed systems",
        "Why are you interested in this stage of our growth?",
        "Anything else you'd like to share?",
    ],
)
def test_claude_may_write_open_ended_answers(label):
    assert claude_may_answer(label, is_long_text=True)


@pytest.mark.parametrize(
    "label",
    [
        "How did you hear about this opportunity?",
        "Do you have a minimum of 7 years of experience building software?",
        "What are your salary expectations?",
        "Where do you plan on working from (for payroll tax purposes)?",
        "Have you ever been convicted of a crime?",
        "When can you start?",
        "What is your notice period?",
        "Additional Links (Website, research paper, etc.)",
    ],
)
def test_claude_never_answers_facts(label):
    assert not claude_may_answer(label, is_long_text=True)


def test_claude_never_answers_a_short_field():
    assert not claude_may_answer("Why do you want to work here?", is_long_text=False)


def test_match_option_exact_partial_and_ambiguous():
    assert match_option(["Select...", "Yes", "No"], "No") == 2
    assert match_option(["Bachelor's degree", "Master's degree"], "Master's") == 1
    assert match_option(["No", "Not sure"], "no") == 0  # exact wins
    assert match_option(["Not sure", "Not now"], "not") == -1  # ambiguous
    assert match_option(["Yes", "No"], None) == -1


def test_consent_and_decline():
    assert is_data_processing_consent("I agree to the processing of my personal data (GDPR)")
    assert not is_data_processing_consent("I consent to a background check")
    assert is_decline_option("Decline to self-identify")
    assert is_decline_option("I don't wish to answer")
    assert not is_decline_option("Male")
