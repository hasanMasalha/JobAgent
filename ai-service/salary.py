"""Expected salary: the user's figure, answered in the currency and period a
question asks for — or not at all.

The user gives an amount, a currency and a period (`User.salary_amount`,
`salary_currency`, `salary_period`: year / month / hour), always gross.
Decided 2026-10-13:
- Month ↔ year is ×12. Never to or from hourly: that needs an assumption about
  hours worked.
- Another currency only if the user turned conversion on
  (`salary_convert_currency`, off by default), at the European Central Bank's
  reference rate (exchange_rates.py) no more than MAX_RATE_AGE_DAYS old.
  Converted figures are rounded: 1,000 a year, 100 a month.
- A question's units come from its label. A bare "$" is US dollars only on a
  job in the US; "kr", "¥", a day or week rate, net / take-home pay and total
  compensation (OTE, bonus, equity) aren't answered.
- A text field whose question doesn't state both gets the figure with its
  units ("20,000 ILS per month") — what the user told us. A number field, or
  a dropdown of ranges, needs both, and a range is picked only when exactly
  one contains the figure.
- A Hebrew question that names neither is monthly NIS, as Israeli forms ask.

Until 2026-10-13 the Profile had one "Expected salary (monthly, NIS)" text,
used only for a question that said monthly or NIS.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

PERIODS = ("year", "month", "hour")
MAX_RATE_AGE_DAYS = 4  # Friday's rate is still the latest on Monday before 16:00 CET

_DATA = json.loads((Path(__file__).parent / "data" / "currencies.json").read_text(encoding="utf-8"))
CURRENCIES: dict[str, str] = {c["code"]: c["name"] for c in _DATA["currencies"]}


@dataclass(frozen=True)
class Salary:
    amount: int
    currency: str
    period: str  # year / month / hour
    convert: bool = False  # may be converted to another currency


@dataclass(frozen=True)
class Rates:
    """ECB reference rates: units of each currency per euro."""

    rate_date: date
    per_eur: dict[str, float] = field(default_factory=dict)

    def fresh(self, today: date | None = None) -> bool:
        return ((today or date.today()) - self.rate_date).days <= MAX_RATE_AGE_DAYS


_AMBIGUOUS = object()

# ── What a question asks for ─────────────────────────────────────────────────

# Symbols and words, longest first ("US$" before "$").
_CURRENCY_MARKS = [
    ("US$", "USD"), ("USD$", "USD"), ("CA$", "CAD"), ("C$", "CAD"), ("AU$", "AUD"), ("A$", "AUD"),
    ("NZ$", "NZD"), ("S$", "SGD"), ("HK$", "HKD"), ("R$", "BRL"),
    ("€", "EUR"), ("£", "GBP"), ("₪", "ILS"), ("₹", "INR"), ("¥", None), ("$", "$"),
]
_CURRENCY_WORDS = [
    (r"(?<![a-z])(us )?dollars?(?![a-z])", "$"), (r"(?<![a-z])euros?(?![a-z])", "EUR"),
    (r"(?<![a-z])pounds?( sterling)?(?![a-z])", "GBP"), (r"(?<![a-z])shekels?(?![a-z])", "ILS"),
    (r"(?<![a-z])rupees?(?![a-z])", "INR"), (r"(?<![a-z])swiss francs?(?![a-z])", "CHF"),
    (r"(?<![a-z])(kr|kronor|kroner|krona|krone)(?![a-z])", None),
    # Hebrew takes prefixes ("בדולרים"), so these match inside a word.
    (r"ש\"ח|ש״ח|שקל", "ILS"), (r"דולר", "$"), (r"יורו|אירו", "EUR"), (r"פאונד|ליש\"ט|ליש״ט", "GBP"),
]
# Codes in capitals ("TRY" is the lira, "try" isn't); a few that aren't words
# also in lower case.
_LOWER_OK = {"USD", "EUR", "GBP", "ILS", "CHF", "CAD", "AUD", "INR", "SGD", "NZD", "HKD"}

_PERIOD_WORDS = [
    (r"\b(annual|annually|yearly|per annum|p\.a\.|year)\b|/\s?(yr|year)\b|שנתי|לשנה", "year"),
    (r"\b(monthly|month)\b|/\s?(mo|month)\b|חודשי|לחודש", "month"),
    (r"\b(hourly|hour)\b|/\s?(hr|hour)\b|לשעה|שעתי", "hour"),
    (r"\b(daily|per day|a day|day rate|weekly|per week|a week)\b|/\s?(day|wk|week)\b", None),
]
_NET = re.compile(r"\b(net|take[- ]home|after tax)\b|נטו")
_TOTAL = re.compile(r"\b(total compensation|total comp|ote|on[- ]target|including bonus|incl\.? bonus|equity|total package)\b")
_HEBREW = re.compile(r"[֐-׿]")


def _currency(text: str, jobs: frozenset[str]):
    found: set = set()
    low = text.lower()
    for mark, code in _CURRENCY_MARKS:
        if mark in text:
            found.add(code)
            text = text.replace(mark, " ")
    for pattern, code in _CURRENCY_WORDS:
        if re.search(pattern, low):
            found.add(code)
    for code in CURRENCIES:
        if re.search(rf"(?<![A-Za-z]){code}(?![A-Za-z])", text) or (
            code in _LOWER_OK and re.search(rf"(?<![a-z]){code.lower()}(?![a-z])", low)
        ):
            found.add(code)
    if re.search(r"(?<![a-z])nis(?![a-z])", low):
        found.add("ILS")
    if "$" in found:
        found.discard("$")
        # A bare dollar is US dollars only on a US job.
        found.add("USD" if jobs == {"US"} else None)
    if None in found or len(found) > 1:
        return _AMBIGUOUS
    return next(iter(found), None)


def _period(low: str):
    found = {p for pattern, p in _PERIOD_WORDS if re.search(pattern, low)}
    if None in found or len(found) > 1:
        return _AMBIGUOUS
    return next(iter(found), None)


@dataclass(frozen=True)
class Units:
    currency: str | None
    period: str | None


def question_units(label: str, jobs: frozenset[str] = frozenset()) -> Units | None:
    """The currency and period a salary question asks for (None where it
    doesn't say). None when it can't be answered from a gross figure, or names
    something we can't tell."""
    text = label or ""
    low = text.lower()
    if _NET.search(low) or _TOTAL.search(low):
        return None
    currency, period = _currency(text, jobs), _period(low)
    if currency is _AMBIGUOUS or period is _AMBIGUOUS:
        return None
    if _HEBREW.search(text):
        currency, period = currency or "ILS", period or "month"
    return Units(currency, period)


# ── Converting the user's figure ─────────────────────────────────────────────

def convert(salary: Salary, currency: str, period: str, rates: Rates | None, today: date | None = None) -> int | None:
    """The user's figure in this currency and period, or None when that can't
    be done honestly."""
    if period not in PERIODS or salary.period not in PERIODS:
        return None
    if (period == "hour") != (salary.period == "hour"):
        return None  # never to or from hourly
    amount = float(salary.amount)
    converted = currency != salary.currency
    if converted:
        if not salary.convert or rates is None or not rates.fresh(today):
            return None
        src, dst = rates.per_eur.get(salary.currency), rates.per_eur.get(currency)
        if not src or not dst:
            return None
        amount = amount * dst / src
    if salary.period == "month" and period == "year":
        amount *= 12
    elif salary.period == "year" and period == "month":
        amount /= 12
    step = {"year": 1000, "month": 100, "hour": 1}[period] if converted else 1
    return int(round(amount / step) * step)


def format_salary(amount: int, currency: str, period: str) -> str:
    return f"{amount:,} {currency} per {period}"


# ── Answers ──────────────────────────────────────────────────────────────────

def salary_text(
    label: str, salary: Salary | None, rates: Rates | None, jobs: frozenset[str] = frozenset(), numeric: bool = False
) -> str | None:
    """The answer to a salary question in a text or number field."""
    if salary is None:
        return None
    units = question_units(label, jobs)
    if units is None:
        return None
    currency, period = units.currency or salary.currency, units.period or salary.period
    amount = convert(salary, currency, period, rates)
    if amount is None:
        return None
    if units.currency and units.period:
        return str(amount)
    if numeric:
        return None  # a bare number in units the question doesn't state
    return format_salary(amount, currency, period)


_DOLLARS = {"USD", "CAD", "AUD", "NZD", "SGD", "HKD"}
_NUMBER = re.compile(r"(\d[\d,.]*)\s*([km])?(?![a-z])", re.IGNORECASE)


def _number(text: str, mult: str | None) -> float:
    value = float(text.replace(",", "")) if text.count(".") <= 1 else float(text.replace(".", "").replace(",", ""))
    return value * {"k": 1_000, "m": 1_000_000}.get((mult or "").lower(), 1)


def _range(option: str) -> tuple[float, float] | None:
    low = option.lower()
    nums = [_number(n, m) for n, m in _NUMBER.findall(low)]
    if not nums:
        return None
    if re.search(r"\b(less than|under|below|up to)\b|<", low) and len(nums) == 1:
        return (0, nums[0])
    if re.search(r"\+|\b(or more|and above|more than|over|above)\b|>", low) and len(nums) == 1:
        return (nums[0], math.inf)
    if len(nums) == 2 and nums[0] <= nums[1]:
        # "100-120k": the second number's k applies to both.
        lo, hi = nums
        if lo < 1000 <= hi and lo * 1000 <= hi:
            lo *= 1000
        return (lo, hi)
    return None


def salary_option(
    label: str, options: list[str], salary: Salary | None, rates: Rates | None, jobs: frozenset[str] = frozenset()
) -> int:
    """The one range option that contains the user's figure, or -1."""
    if salary is None:
        return -1
    units = question_units(label, jobs)
    if units is None:
        return -1
    hits = []
    for i, option in enumerate(options):
        if units.currency in _DOLLARS:
            option = option.replace(units.currency, "").replace("$", "")  # "$50k" under "(USD)"
        span = _range(option)
        if span is None:
            continue
        opt_units = question_units(option, jobs)
        if opt_units is None:
            return -1
        currency = opt_units.currency or units.currency
        period = opt_units.period or units.period
        if not currency or not period:
            return -1
        amount = convert(salary, currency, period, rates)
        if amount is None:
            return -1
        if span[0] <= amount <= span[1]:
            hits.append(i)
    return hits[0] if len(hits) == 1 else -1
