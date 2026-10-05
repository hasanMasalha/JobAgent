"""The phone's country for an ATS phone picker: placed from the number, never
guessed. See phone_country.py."""

import pytest

from phone_country import match_country_option, parse_phone


@pytest.mark.parametrize(
    "raw, region, dial, national",
    [
        ("+972 50-234-5678", "IL", "+972", "0502345678"),
        ("+972501234567", "IL", "+972", "0501234567"),  # not strictly valid; +972 is Israel only
        ("050-1234567", "IL", "+972", "0501234567"),    # Profile's old local format
        ("+44 7400 123456", "GB", "+44", "07400123456"),
        ("0044 7400 123456", "GB", "+44", "07400123456"),
        ("+1 202 555 0123", "US", "+1", "2025550123"),
        ("+1 (213) 373-4253", "US", "+1", "2133734253"),
        ("+1 416 555 0199", "CA", "+1", "4165550199"),
        ("+49 1512 3456789", "DE", "+49", "015123456789"),
        ("+44 7911 123456", "GG", "+44", "07911123456"),  # a Guernsey mobile range
    ],
)
def test_places_the_number(raw, region, dial, national):
    info = parse_phone(raw)
    assert info is not None
    assert (info.region, info.dial_code, info.national_digits) == (region, dial, national)


@pytest.mark.parametrize(
    "raw",
    [
        "",
        None,
        "not a number",
        "2025550123",         # no country code, no trunk 0
        "+44 7700 900123",    # invalid, and +44 is shared: UK or Guernsey?
        "+1 555 555 5555",    # invalid, and +1 is shared
        "+999 1234",
    ],
)
def test_cannot_be_placed(raw):
    assert parse_phone(raw) is None


def test_local_numbers_are_read_as_israeli_only():
    # Profile asked Israeli users for local format. A UK local number is read
    # as Israeli digits and isn't a plausible Israeli number.
    assert parse_phone("050-234-5678").region == "IL"
    assert parse_phone("07400 123456") is None


def test_country_names():
    assert parse_phone("+44 7400 123456").country_name == "United Kingdom"
    assert parse_phone("+1 416 555 0199").country_name == "Canada"


GREENHOUSE_OPTIONS = [
    "🇺🇸 United States +1",
    "🇨🇦 Canada +1",
    "🇬🇧 United Kingdom +44",
    "🇬🇬 Guernsey +44",
    "🇮🇱 Israel +972",
    "🇩🇪 Germany +49",
    "🇯🇪 Jersey +44",
]


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("+1 202 555 0123", "🇺🇸 United States +1"),
        ("+1 416 555 0199", "🇨🇦 Canada +1"),
        ("+44 7400 123456", "🇬🇧 United Kingdom +44"),
        ("+44 7911 123456", "🇬🇬 Guernsey +44"),
        ("+972 50-234-5678", "🇮🇱 Israel +972"),
        ("+49 1512 3456789", "🇩🇪 Germany +49"),
    ],
)
def test_picks_the_option_by_name_and_dial_code(raw, expected):
    assert GREENHOUSE_OPTIONS[match_country_option(GREENHOUSE_OPTIONS, parse_phone(raw))] == expected


def test_intl_tel_input_style_options():
    # intl-tel-input lists the native name in brackets, with RTL marks.
    options = ["Israel (\u202bישראל\u202c\u200e)+972", "Italy (Italia)+39", "United Kingdom+44"]
    assert match_country_option(options, parse_phone("+972 50-234-5678")) == 0
    assert match_country_option(options, parse_phone("+44 7400 123456")) == 2


def test_aliases():
    assert match_country_option(["UK +44", "France +33"], parse_phone("+44 7400 123456")) == 0
    assert match_country_option(["USA (+1)", "Canada (+1)"], parse_phone("+1 202 555 0123")) == 0


def test_options_without_dial_codes_match_by_name():
    assert match_country_option(["Germany", "Israel"], parse_phone("+972 50-234-5678")) == 1


@pytest.mark.parametrize(
    "options",
    [
        ["Israel +44"],                     # right name, wrong dial code
        ["+972"],                           # a dial code with no name
        ["Israel +972", "Israel"],          # two matches: ambiguous
        ["Palestine +972"],                 # same code, another country
    ],
)
def test_no_match_rather_than_a_guess(options):
    assert match_country_option(options, parse_phone("+972 50-234-5678")) == -1
