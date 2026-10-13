"""Work authorisation per country (2026-10-13): answered from the user's list,
for the country the question names or else the job's — and never a guess
when that country can't be told."""

import pytest

from application_answers import ApplicantData, boolean_answer, user_answer
from work_authorisation import WorkAuth, job_countries, question_countries


# Real Job.location values (top of the production table, 2026-10-13).
@pytest.mark.parametrize(
    "location, expected",
    [
        ("London, United Kingdom", {"GB"}),
        ("London, ENG, GB", {"GB"}),
        ("London, ENG, UK", {"GB"}),
        ("Berlin, BE, DE", {"DE"}),
        ("M�nchen, Germany", {"DE"}),
        ("Tel Aviv-Yafo, Tel Aviv District, Israel", {"IL"}),
        ("Tel Aviv", {"IL"}),
        ("תל אביב -יפו, TA, IL", {"IL"}),
        ("מיקום המשרה:תל אביב יפו", {"IL"}),
        ("Location:Tel Aviv-Yafo", {"IL"}),
        ("Israel - Tel Aviv", {"IL"}),
        ("Remote, US", {"US"}),
        ("Remote - United States", {"US"}),
        ("San Francisco, CA, US", {"US"}),
        ("New York, NY", {"US"}),
        ("Seattle, WA", {"US"}),
        ("Chicago, IL", {"US"}),  # Illinois, not Israel
        ("Jersey City, NJ", {"US"}),
        ("Amsterdam, NH, NL", {"NL"}),
        ("Remote - Ontario, Canada", {"CA"}),
        ("Belfast, Northern Ireland, United Kingdom", {"GB"}),
        ("Sydney, Australia, United Kingdom", {"AU", "GB"}),
        ("United States, Canada, Spain, Czech Republic, United Kingdom", {"US", "CA", "ES", "CZ", "GB"}),
        # A city's name then a code that is a state's and a country's: the US
        # state, unless it's a city we know elsewhere; a region code first: the country.
        ("Atlanta, GA", {"US"}),
        ("Campbell, CA", {"US"}),
        ("Indianapolis, IN", {"US"}),
        ("Toronto, CA", {"CA"}),
        ("M, IL", {"IL"}),
        ("BY, DE", {"DE"}),
        # US towns named after countries.
        ("Malta, MT, USA", {"US"}),
        ("Lebanon, NJ, US", {"US"}),
        # Several places.
        ("Chicago, IL; Los Angeles, CA; New York City, NY; San Francisco, CA", {"US"}),
        ("London, UK or Zurich, Switzerland", {"GB", "CH"}),
        ("London; Tel Aviv-Yafo, Tel Aviv District, Israel", {"GB", "IL"}),
        ("DE", {"DE"}),
        ("IL", {"IL"}),
        # Can't be told: no country, or a code that is a US state too.
        ("", set()),
        ("Remote", set()),
        ("Home Office, DE", set()),  # Germany or Delaware
        ("West Coast", set()),
        ("Bristol; Chemnitz, Sachsen", set()),  # one place we can't tell: not all of them
    ],
)
def test_job_countries(location, expected):
    assert job_countries(location) == expected


@pytest.mark.parametrize(
    "label, expected",
    [
        ("Are you legally authorized to work in the United States?", {"US"}),
        ("Are you legally authorized to work in the U.S.?", {"US"}),
        ("Do you have the right to work in the UK?", {"GB"}),
        ("Are you eligible to work in California?", {"US"}),
        ("Are you authorised to work in the EU?", {"EU"}),
        ("Are you authorized to work in the US or Canada?", {"US", "CA"}),
        ("Will you require sponsorship to work in Northern Ireland?", {"GB"}),
        # No country, "us" the pronoun, "this country": the job's.
        ("Are you legally authorized to work?", {"IL"}),
        ("Please tell us: are you legally authorized to work?", {"IL"}),
        ("Are you legally authorized to work in the country where this job is located?", {"IL"}),
    ],
)
def test_question_countries(label, expected):
    assert question_countries(label, frozenset({"IL"})) == expected


def test_question_countries_cant_be_told():
    assert question_countries("Are you authorized to work in Georgia?", frozenset({"IL"})) is None
    assert question_countries("Are you authorized to work in Europe?", frozenset({"IL"})) is None
    assert question_countries("Are you legally authorized to work?", frozenset()) is None


def dana(**kw) -> ApplicantData:
    """Israeli citizen on a UK Skilled Worker visa; list saved."""
    base = {
        "work_countries": frozenset({"IL", "GB"}),
        "sponsorship_later_countries": frozenset({"GB"}),
        "work_auth_confirmed": True,
        "job_countries": frozenset({"IL"}),
    }
    return ApplicantData(**{**base, **kw})


@pytest.mark.parametrize(
    "label, expected",
    [
        ("Are you legally authorized to work in Israel?", True),
        ("Are you legally authorized to work in the United Kingdom?", True),
        ("Are you legally authorized to work in the United States?", False),  # not on the list
        ("Are you legally authorized to work in the country where this job is located?", True),
        ("Will you now or in the future require sponsorship to work in the US?", True),  # not on the list
        ("Will you now or in the future require sponsorship to work in the UK?", True),  # visa, later
        ("Do you currently require sponsorship to work in the UK?", False),  # allowed now
        ("Will you require visa sponsorship?", False),  # the job is in Israel
        ("Do you need a visa to work in Israel?", False),
        # Different answers for the countries it names: not answered.
        ("Are you authorized to work in the UK or the US?", None),
    ],
)
def test_answers_from_the_list(label, expected):
    assert boolean_answer(label, dana()) is expected


def test_the_job_country_decides_a_question_naming_none():
    assert boolean_answer("Are you legally authorized to work?", dana(job_countries=frozenset({"US"}))) is False
    assert boolean_answer("Will you require visa sponsorship?", dana(job_countries=frozenset({"US"}))) is True
    # A job we can't place, or in two countries with different answers: left.
    assert boolean_answer("Are you legally authorized to work?", dana(job_countries=frozenset())) is None
    assert boolean_answer("Are you legally authorized to work?", dana(job_countries=frozenset({"IL", "US"}))) is None
    assert boolean_answer("Are you legally authorized to work?", dana(job_countries=frozenset({"IL", "GB"}))) is True


def test_eu_citizen():
    eu = dana(work_countries=frozenset({"EU"}), sponsorship_later_countries=frozenset())
    assert boolean_answer("Are you authorised to work in Germany?", eu) is True
    assert boolean_answer("Are you authorised to work in Switzerland?", eu) is True
    assert boolean_answer("Are you authorised to work in the European Union?", eu) is True
    assert boolean_answer("Will you require sponsorship to work in France?", eu) is False
    assert boolean_answer("Are you authorised to work in the UK?", eu) is False
    # Allowed in Germany (a German visa) isn't the EU as a whole.
    de = dana(work_countries=frozenset({"DE"}), sponsorship_later_countries=frozenset())
    assert boolean_answer("Are you authorised to work in the EU?", de) is None
    assert boolean_answer("Are you authorised to work in France?", de) is False


def test_until_the_list_is_saved_only_israel_is_answered_as_before():
    old = ApplicantData(work_authorized=True, requires_sponsorship=False,
                        work_countries=frozenset({"IL"}), job_countries=frozenset({"IL"}))
    assert boolean_answer("Are you legally authorized to work in Israel?", old) is True
    assert boolean_answer("Will you require visa sponsorship?", old) is False
    assert boolean_answer("Are you legally authorized to work in the United States?", old) is None
    assert boolean_answer("Will you require sponsorship to work in the UK?", old) is None
    on_us_job = ApplicantData(work_authorized=True, requires_sponsorship=False, job_countries=frozenset({"US"}))
    assert boolean_answer("Will you require visa sponsorship?", on_us_job) is None


def test_a_saved_empty_list_is_no_answer_not_nowhere():
    nobody = dana(work_countries=frozenset(), sponsorship_later_countries=frozenset())
    assert boolean_answer("Are you legally authorized to work in the United States?", nobody) is None
    assert boolean_answer("Will you require sponsorship to work in the US?", nobody) is None


@pytest.mark.parametrize(
    "label",
    [
        "Do you give authorization for a background check?",
        "Authorization to process your personal data",
        "What is your right to work or visa status?",
        "Which visa will you need?",
    ],
)
def test_not_a_work_authorisation_yes_no(label):
    assert boolean_answer(label, dana()) is None


def test_a_yes_no_only_for_a_question_with_options():
    label = "Are you legally authorized to work in the United States?"
    assert user_answer(label, dana()) is None
    assert user_answer(label, dana(), choice=True) == "No"


def test_from_row_reads_the_list_and_the_job():
    row = {"work_countries": ["IL", "GB"], "sponsorship_later_countries": ["GB"],
           "work_auth_confirmed_at": "2026-10-13T10:00:00Z"}
    data = ApplicantData.from_row(row, job_location="London, United Kingdom")
    assert data.work_auth == WorkAuth(
        countries=frozenset({"IL", "GB"}), sponsorship_later=frozenset({"GB"}), confirmed=True,
    )
    assert data.job_countries == {"GB"}
    assert ApplicantData.from_row({}).work_auth.confirmed is False
