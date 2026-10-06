"""form_questions: an ATS form's questions without a browser, in the shape
answer_resolver takes. Fixtures are trimmed from live responses (2026-10-06)."""

import pytest

from application_answers import claude_may_answer
from form_questions import ashby_form, ashby_ids, greenhouse_form, greenhouse_ids

GREENHOUSE_JOB = {
    "questions": [
        {"label": "First Name", "required": True, "fields": [{"name": "first_name", "type": "input_text", "values": []}]},
        {"label": "Resume/CV", "required": True, "fields": [
            {"name": "resume", "type": "input_file", "values": []},
            {"name": "resume_text", "type": "textarea", "values": []}]},
        {"label": "How did you hear about this job?", "required": True,
         "fields": [{"name": "question_1", "type": "input_text", "values": []}]},
        {"label": "Are you legally authorized to work in Israel?", "required": True, "fields": [
            {"name": "question_2", "type": "multi_value_single_select",
             "values": [{"label": "Yes", "value": 1}, {"label": "No", "value": 0}]}]},
        {"label": "Pick all that apply", "required": False, "fields": [
            {"name": "question_3[]", "type": "multi_value_multi_select", "values": [{"label": "A", "value": 1}]}]},
        {"label": "Hidden", "required": False, "fields": [{"name": "h", "type": "input_hidden", "values": []}]},
    ],
    "location_questions": [
        {"label": "Latitude", "required": False, "fields": [{"name": "latitude", "type": "input_hidden"}]},
        {"label": "Location", "required": False, "fields": [{"name": "location", "type": "input_text"}]},
    ],
    "compliance": [{"type": "eeoc", "questions": [{"label": "VeteranStatus", "required": False, "fields": [
        {"name": "veteran_status", "type": "multi_value_single_select",
         "values": [{"label": "I don't wish to answer", "value": "3"}]}]}]}],
    "demographic_questions": {"header": "Voluntary", "questions": [
        {"id": 1757, "label": "Gender", "required": True, "type": "multi_value_single_select",
         "answer_options": [{"label": "Female"}, {"label": "Prefer not to say"}]}]},
}


def test_greenhouse_form():
    qs = {q.id: q for q in greenhouse_form(GREENHOUSE_JOB)}

    assert (qs["first_name"].kind, qs["first_name"].role, qs["first_name"].required) == ("text", "first_name", True)
    assert (qs["resume"].kind, qs["resume"].role) == ("file", "resume")  # not the paste-in textarea
    assert "resume_text" not in qs and "h" not in qs and "latitude" not in qs
    assert qs["question_2"].kind == "select" and qs["question_2"].options == ["Yes", "No"]
    assert qs["question_3[]"].kind == "multi_select"
    assert qs["location"].kind == "location"
    assert qs["veteran_status"].eeo and not qs["veteran_status"].required
    assert qs["demographic_1757"].eeo and qs["demographic_1757"].options == ["Female", "Prefer not to say"]


@pytest.mark.parametrize(
    "url, ids",
    [
        ("https://job-boards.greenhouse.io/embed/job_app?for=airbnb&token=8184174", ("airbnb", "8184174")),
        ("https://job-boards.greenhouse.io/datadog/jobs/7194969", ("datadog", "7194969")),
        ("https://boards.greenhouse.io/acme/jobs/123?gh_src=x", ("acme", "123")),
        ("https://careers.acme.com/jobs?gh_jid=123", None),  # resolved to the embed URL first
    ],
)
def test_greenhouse_ids(url, ids):
    assert greenhouse_ids(url) == ids


ASHBY_POSTING = {
    "applicationForm": {"sections": [
        {"isHidden": False, "fieldEntries": [
            {"isRequired": True, "field": {"path": "_systemfield_name", "title": "Full Name", "type": "String"}},
            {"isRequired": True, "field": {"path": "_systemfield_resume", "title": "Resume", "type": "File"}},
            {"isRequired": False, "field": {"path": "cl", "title": "Cover Letter", "type": "File"}},
            {"isRequired": True, "field": {"path": "ph", "title": "Phone", "type": "Phone"}},
            {"isRequired": True, "field": {"path": "visa", "title": "Will you require sponsorship?", "type": "Boolean"}},
            {"isRequired": False, "field": {"path": "src", "title": "How did you hear?", "type": "MultiValueSelect",
                                            "selectableValues": [{"label": "LinkedIn"}, {"label": "Friend"}]}},
            {"isRequired": True, "isHidden": True, "field": {"path": "x", "title": "Hidden", "type": "String"}},
        ]},
        {"isHidden": True, "fieldEntries": [{"isRequired": True, "field": {"path": "y", "title": "Y", "type": "String"}}]},
    ]},
    "surveyForms": [{"sections": [{"fieldEntries": [
        {"isRequired": False, "field": {"path": "g", "title": "Gender", "type": "ValueSelect",
                                        "selectableValues": [{"label": "Decline to self-identify"}]}}]}]}],
}


def test_ashby_form():
    qs = {q.id: q for q in ashby_form(ASHBY_POSTING)}

    assert qs["_systemfield_name"].role == "full_name"
    assert qs["_systemfield_resume"].role == "resume"
    assert qs["cl"].role == "cover_letter"
    assert (qs["ph"].kind, qs["ph"].role) == ("phone", "phone")
    assert qs["visa"].kind == "boolean"
    assert qs["src"].kind == "multi_select" and qs["src"].options == ["LinkedIn", "Friend"]
    assert "x" not in qs and "y" not in qs  # hidden field and hidden section
    assert qs["g"].eeo


def test_ashby_ids():
    assert ashby_ids("https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application") == (
        "ramp", "34413f8d-26bf-4bbc-8ade-eb309a0e2245")
    assert ashby_ids("https://example.com/jobs/1") is None


@pytest.mark.parametrize(
    "label, allowed",
    [
        ("Why do you want to work at Ramp?", True),
        ("Describe your experience with automated testing", True),
        ("What excites you about working with robotics?", True),
        # Ramp's Ashby form, 2026-10-06: the employer asks the person.
        (
            (
                "In the above question, we ask you to figure out a secret to prove that you are not a bot "
                "auto-applying to the role. How could we do so more effectively?"
            ),
            False,
        ),
        ("Here's some text encoded in a common format. Decode it and tell us the secret", False),
        ("Describe in your own words why you are not a robot", False),
    ],
)
def test_claude_never_answers_a_check_that_a_person_is_applying(label, allowed):
    assert claude_may_answer(label, is_long_text=True) is allowed
