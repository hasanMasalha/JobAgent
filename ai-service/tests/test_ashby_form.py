"""Ashby forms are read from Ashby's own form definition and answered only
from the user's data. Field shapes below are from live postings (2026-10-04)."""
import pytest

from application_answers import ApplicantData
from ashby_form import pick_location, plan


def _entry(path, ftype, title, required, options=None):
    field = {"path": path, "type": ftype, "title": title}
    if options:
        field["selectableValues"] = [{"label": o, "value": o} for o in options]
    return {"field": field, "isRequired": required}


def _posting(*entries, survey=None):
    p = {"applicationForm": {"sections": [{"fieldEntries": list(entries)}]}}
    if survey:
        p["surveyForms"] = [{"sections": [{"fieldEntries": survey}]}]
    return p


BASIC = [
    _entry("_systemfield_name", "String", "Name", True),
    _entry("_systemfield_email", "Email", "Email", True),
    _entry("_systemfield_resume", "File", "Resume", True),
]
DANA = ApplicantData(first_name="Dana", last_name="Levi", email="dana@example.com",
                     phone="+972501234567", city="Tel Aviv", years_of_experience="6",
                     work_authorized=True, requires_sponsorship=False)


def _by_path(actions):
    return {a.path: a for a in actions}


def test_basic_fields_from_the_user():
    actions, missing = plan(_posting(*BASIC), DANA)
    a = _by_path(actions)
    assert missing == []
    assert a["_systemfield_name"].value == "Dana Levi"
    assert a["_systemfield_email"].value == "dana@example.com"
    assert a["_systemfield_resume"].kind == "file"


def test_lumai_form_open_ended_goes_to_claude_and_how_heard_stops_it():
    # The live Lumai posting: two required free-text questions.
    posting = _posting(
        *BASIC,
        _entry("cb5c", "LongText", "What excites you about Lumai?", True),
        _entry("77df", "LongText", "How did you hear about this opportunity?", True),
        _entry("956e", "String", "LinkedIn Profile", False),
    )
    actions, missing = plan(posting, DANA)
    assert _by_path(actions)["cb5c"].kind == "claude"
    assert missing == ["How did you hear about this opportunity?"]
    # With a saved answer for that question, nothing is missing.
    saved = ApplicantData(**{**DANA.__dict__, "saved_answers": {"how did you hear about this opportunity?": "A friend"}})
    actions, missing = plan(posting, saved)
    assert missing == [] and _by_path(actions)["77df"].value == "A friend"


def test_factual_yes_no_without_the_users_answer_stops():
    posting = _posting(*BASIC, _entry("3080", "Boolean",
                                      "Do you have a minimum of 7 years of experience building software?", True))
    _, missing = plan(posting, DANA)
    assert missing == ["Do you have a minimum of 7 years of experience building software?"]


def test_yes_no_from_the_profile_only_for_the_question_it_was_asked_as():
    posting = _posting(
        *BASIC,
        _entry("s", "Boolean", "Will you require visa sponsorship?", True),
        _entry("w", "Boolean", "Are you authorized to work in Israel?", True),
        _entry("u", "Boolean", "Are you authorized to work in the United Kingdom?", True),
    )
    actions, missing = plan(posting, DANA)
    a = _by_path(actions)
    assert a["s"].value == "no" and a["w"].value == "yes"
    assert missing == ["Are you authorized to work in the United Kingdom?"]


def test_optional_unanswered_questions_are_left_and_dont_stop():
    posting = _posting(
        *BASIC,
        _entry("p", "ValueSelect", "What pronouns would you like our team to use?", False,
               ["He/Him", "She/Her", "They/Them", "Prefer not to say"]),
        _entry("h", "MultiValueSelect", "How did you hear about this opportunity? (select all that apply)", False,
               ["LinkedIn", "Glassdoor"]),
        _entry("f", "File", "Cover letter", False),
    )
    actions, missing = plan(posting, DANA)
    assert missing == []
    assert set(_by_path(actions)) == {"_systemfield_name", "_systemfield_email", "_systemfield_resume"}


def test_choice_uses_a_saved_answer_matching_an_option():
    data = ApplicantData(**{**DANA.__dict__, "saved_answers": {"how did you hear about us?": "glassdoor"}})
    posting = _posting(*BASIC, _entry("h", "ValueSelect", "How did you hear about us?", True, ["LinkedIn", "Glassdoor"]))
    actions, missing = plan(posting, data)
    assert missing == [] and _by_path(actions)["h"].value == "Glassdoor"


def test_location_and_phone():
    posting = _posting(*BASIC, _entry("_systemfield_location", "Location", "Where are you based?", True),
                       _entry("ph", "Phone", "Phone", True))
    a = _by_path(plan(posting, DANA)[0])
    assert a["_systemfield_location"].kind == "location" and a["_systemfield_location"].value == "Tel Aviv"
    assert a["ph"].value == "+972501234567"
    _, missing = plan(posting, ApplicantData(first_name="A", last_name="B", email="a@b.c"))
    assert missing == ["Where are you based?", "Phone"]


def test_eeo_survey_declines_only_when_required():
    survey = [
        _entry("g", "ValueSelect", "Gender", True, ["Male", "Female", "Decline to self-identify"]),
        _entry("r", "ValueSelect", "Race", False, ["Asian", "Decline to self-identify"]),
        _entry("v", "ValueSelect", "Veteran Status", True, ["I am a protected veteran", "I am not a protected veteran"]),
    ]
    actions, missing = plan(_posting(*BASIC, survey=survey), DANA)
    a = _by_path(actions)
    assert a["g"].value == "Decline to self-identify"
    assert "r" not in a  # optional: left alone
    assert missing == ["Veteran Status"]  # required, no decline option: never guessed


def test_missing_name_or_email_stops():
    _, missing = plan(_posting(*BASIC), ApplicantData())
    assert missing == ["Name", "Email"]


@pytest.mark.parametrize(
    "options, city, expected",
    [
        (["London, Greater London, England, United Kingdom", "London, Ontario, Canada"], "London", -1),
        (["London, Greater London, England, United Kingdom", "London, Ontario, Canada"], "London, Ontario", 1),
        (["Tel Aviv-Yafo, Tel Aviv District, Israel"], "Tel Aviv-Yafo", 0),
        (["Tel Aviv-Yafo, Tel Aviv District, Israel"], "Haifa", -1),
        ([], "Berlin", -1),
    ],
)
def test_pick_location_needs_exactly_one_match(options, city, expected):
    assert pick_location(options, city) == expected
