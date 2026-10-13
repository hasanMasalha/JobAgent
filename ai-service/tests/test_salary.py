"""salary.py / exchange_rates.py (2026-10-13): the expected salary in the
currency and period a question asks for — converted only when the user allows
it, at a fresh ECB rate — or no answer."""

import asyncio
from datetime import date, timedelta

import pytest

from application_answers import ApplicantData, option_answer, user_answer
from exchange_rates import load_rates, parse_ecb, store_rates
from salary import Rates, Salary, convert, question_units, salary_option, salary_text

TODAY = date.today()
RATES = Rates(TODAY, {"EUR": 1.0, "ILS": 4.0, "USD": 1.08, "GBP": 0.85, "CAD": 1.5})
NIS_MONTH = Salary(20000, "ILS", "month", convert=True)


@pytest.mark.parametrize(
    "label, currency, period",
    [
        ("Expected annual salary (USD)", "USD", "year"),
        ("Salary expectations (€/yr)", "EUR", "year"),
        ("Expected monthly salary in NIS", "ILS", "month"),
        ("Desired salary (£ per annum)", "GBP", "year"),
        ("Expected salary, CA$ per year", "CAD", "year"),
        ("Hourly rate expectations (USD)", "USD", "hour"),
        ("What are your salary expectations?", None, None),
        # A Hebrew question that names neither: monthly NIS, as Israeli forms ask.
        ("שכר מבוקש", "ILS", "month"),
        ("שכר שנתי מבוקש בדולרים", None, "year"),  # dollars, not on a US job: see below
    ],
)
def test_question_units(label, currency, period):
    units = question_units(label)
    if label == "שכר שנתי מבוקש בדולרים":
        assert units is None  # a bare dollar off a US job
        return
    assert (units.currency, units.period) == (currency, period)


@pytest.mark.parametrize(
    "label",
    [
        "Expected net salary",
        "Take-home pay expected",
        "שכר נטו",
        "Total compensation expectations (OTE)",
        "Expected salary including bonus",
        "Day rate (GBP)",
        "Weekly pay",
        "Salary expectations (kr)",
        "Salary in USD or EUR",
        "Expected salary ($)",  # a bare dollar, job not in the US
    ],
)
def test_questions_not_answered_from_a_gross_figure(label):
    assert question_units(label) is None
    assert salary_text(label, NIS_MONTH, RATES) is None


def test_a_bare_dollar_is_usd_on_a_us_job():
    assert question_units("Expected salary ($ per year)", frozenset({"US"})).currency == "USD"
    assert question_units("Expected salary ($ per year)", frozenset({"CA"})) is None


def test_period_and_currency_conversion():
    # Month → year is ×12, no rounding without a currency change.
    assert convert(Salary(20833, "ILS", "month"), "ILS", "year", None) == 249996
    assert convert(Salary(250000, "ILS", "year"), "ILS", "month", None) == 20833
    # Converted: 240,000 ILS a year / 4 × 1.08 = 64,800 → 65,000.
    assert convert(NIS_MONTH, "USD", "year", RATES) == 65000
    assert convert(NIS_MONTH, "USD", "month", RATES) == 5400
    # Never to or from hourly.
    assert convert(NIS_MONTH, "ILS", "hour", RATES) is None
    assert convert(Salary(50, "USD", "hour", True), "USD", "year", RATES) is None
    assert convert(Salary(50, "USD", "hour", True), "GBP", "hour", RATES) == 39


def test_conversion_needs_permission_and_a_fresh_rate():
    assert convert(Salary(20000, "ILS", "month", convert=False), "USD", "year", RATES) is None
    assert convert(NIS_MONTH, "USD", "year", None) is None
    old = Rates(TODAY - timedelta(days=5), RATES.per_eur)
    assert convert(NIS_MONTH, "USD", "year", old) is None
    weekend = Rates(TODAY - timedelta(days=3), RATES.per_eur)  # Friday's rate on a Monday morning
    assert convert(NIS_MONTH, "USD", "year", weekend) == 65000
    assert convert(NIS_MONTH, "JPY", "year", RATES) is None  # no rate for it


@pytest.mark.parametrize(
    "label, numeric, expected",
    [
        # The question states both: the bare figure, converted.
        ("Expected annual salary (USD)", False, "65000"),
        ("Expected annual salary (USD)", True, "65000"),
        ("Expected monthly salary in NIS", True, "20000"),
        # It doesn't: the figure with its units in a text field…
        ("What are your salary expectations?", False, "20,000 ILS per month"),
        ("Expected annual salary", False, "240,000 ILS per year"),
        ("Expected salary in GBP", False, "4,200 GBP per month"),
        # …and nothing in a number field.
        ("What are your salary expectations?", True, None),
        ("Expected annual salary", True, None),
    ],
)
def test_salary_text(label, numeric, expected):
    assert salary_text(label, NIS_MONTH, RATES, numeric=numeric) == expected


OPTIONS = ["Less than $50k", "$50k - $70k", "$70,000 - $90,000", "$90k+", "Prefer not to say"]


def test_a_range_is_picked_only_when_exactly_one_holds_the_figure():
    assert salary_option("Expected annual salary (USD)", OPTIONS, NIS_MONTH, RATES) == 1  # 65,000
    assert salary_option("Expected annual salary", OPTIONS, NIS_MONTH, RATES, frozenset({"US"})) == 1
    # Units unknown: "$" off a US job, or no period.
    assert salary_option("Expected annual salary", OPTIONS, NIS_MONTH, RATES, frozenset({"IL"})) == -1
    assert salary_option("Expected salary (USD)", OPTIONS, NIS_MONTH, RATES) == -1
    # On a boundary of two ranges: neither.
    edge = Salary(70000, "USD", "year")
    assert salary_option("Expected annual salary (USD)", ["$50k-$70k", "$70k-$90k"], edge, None) == -1
    assert salary_option("Expected annual salary (USD)", ["50-70k", "71-90k"], edge, None) == 0
    # Not allowed to convert.
    assert salary_option("Expected annual salary (USD)", OPTIONS, Salary(20000, "ILS", "month"), RATES) == -1


def test_through_the_applicant():
    data = ApplicantData(salary=NIS_MONTH, rates=RATES, job_countries=frozenset({"US"}))
    assert user_answer("Expected annual salary (USD)", data) == "65000"
    assert option_answer("Expected annual salary", OPTIONS, data) == 1
    # A saved answer for the exact question still comes first.
    data.saved_answers = {"expected annual salary": "$70,000 - $90,000"}
    assert option_answer("Expected annual salary", OPTIONS, data) == 2
    assert ApplicantData().salary is None and user_answer("Expected salary", ApplicantData()) is None


def test_from_row():
    row = {"salary_amount": 20000, "salary_currency": "ILS", "salary_period": "month", "salary_convert_currency": True}
    assert ApplicantData.from_row(row).salary == NIS_MONTH
    assert ApplicantData.from_row({**row, "salary_currency": "XYZ"}).salary is None
    assert ApplicantData.from_row({**row, "salary_period": "week"}).salary is None
    assert ApplicantData.from_row({**row, "salary_amount": 0}).salary is None
    assert ApplicantData.from_row({**row, "salary_convert_currency": None}).salary.convert is False


ECB_XML = """<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube><Cube time="2026-10-13"><Cube currency="USD" rate="1.1188"/><Cube currency="ILS" rate="3.4404"/></Cube></Cube>
</gesmes:Envelope>"""


def test_parse_ecb():
    rates = parse_ecb(ECB_XML)
    assert rates.rate_date == date(2026, 10, 13)
    assert rates.per_eur == {"EUR": 1.0, "USD": 1.1188, "ILS": 3.4404}
    with pytest.raises(ValueError):
        parse_ecb("<Envelope><Cube/></Envelope>")


class _Conn:
    def __init__(self, rows=()):
        self.rows, self.calls = list(rows), []

    def transaction(self):
        conn = self

        class _Tx:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *_):
                return False

        return _Tx()

    async def execute(self, sql, *args):
        self.calls.append((sql, args))

    async def fetch(self, sql, *args):
        return self.rows


def test_store_replaces_and_load_uses_the_oldest_date():
    conn = _Conn()
    asyncio.run(store_rates(conn, parse_ecb(ECB_XML)))
    assert "DELETE" in conn.calls[0][0] and sorted(conn.calls[0][1][0]) == ["EUR", "ILS", "USD"]
    assert len(conn.calls) == 4
    rows = [{"currency": "USD", "per_eur": 1.1, "rate_date": date(2026, 10, 13)},
            {"currency": "ILS", "per_eur": 3.4, "rate_date": date(2026, 10, 9)}]
    assert asyncio.run(load_rates(_Conn(rows))).rate_date == date(2026, 10, 9)
    assert asyncio.run(load_rates(_Conn())) is None
