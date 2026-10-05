"""Which country a user's phone number belongs to, for an ATS phone picker.

Greenhouse forms ask for the phone's country (a dial-code picker) next to the
number. This works it out from the number the user saved on Profile, and
never guesses:

- An international number ("+44 …" or "0044 …") is placed by its dial code.
  When the code belongs to one country (+972, +49) a plausible number is
  enough. When it's shared (+1 US / Canada / Caribbean, +44 UK / Guernsey /
  Jersey / Isle of Man, +7 Russia / Kazakhstan) the number has to be valid,
  so the library can tell which; otherwise it isn't placed. Some +44 ranges
  belong to Guernsey, Jersey or the Isle of Man, and are placed there.
- A number without a country code is only placed if it's Israeli ("05…"):
  Profile used to ask for Israeli numbers in local format. Anything else
  can't be placed — Profile asks for the international format.

Unplaced → None, and the picker is left alone (a board that requires it
stops as a missing answer: needs_manual, credit refunded).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

import phonenumbers
from phonenumbers import geocoder


@dataclass(frozen=True)
class PhoneInfo:
    region: str           # ISO 3166-1 alpha-2, e.g. "GB"
    country_name: str     # English name, e.g. "United Kingdom"
    dial_code: str        # e.g. "+44"
    national_digits: str  # national format, digits only, e.g. "07400123456"
    e164: str             # e.g. "+447400123456"


def parse_phone(raw: str | None) -> PhoneInfo | None:
    """The phone's country and formats, or None if it can't be placed."""
    compact = re.sub(r"[\s\-().]", "", (raw or "").strip())
    if not compact:
        return None
    try:
        if compact.startswith(("+", "00")):
            international = "+" + compact[2:] if compact.startswith("00") else compact
            number = phonenumbers.parse(international, None)
            region = _region(number)
        elif compact.startswith("0"):
            # Israeli mobile ("05…", the old _is_israeli_phone rule) or any
            # valid Israeli number; another country's local number is not.
            number = phonenumbers.parse(compact, "IL")
            region = "IL" if compact.startswith("05") or phonenumbers.is_valid_number(number) else None
        else:
            return None
    except phonenumbers.NumberParseException:
        return None

    if not region or not phonenumbers.is_possible_number(number):
        return None

    national = phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.NATIONAL)
    return PhoneInfo(
        region=region,
        country_name=country_name(region),
        dial_code=f"+{number.country_code}",
        national_digits=re.sub(r"\D", "", national),
        e164=phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164),
    )


def _region(number: phonenumbers.PhoneNumber) -> str | None:
    if phonenumbers.is_valid_number(number):
        return phonenumbers.region_code_for_number(number)
    regions = phonenumbers.region_codes_for_country_code(number.country_code)
    return regions[0] if len(regions) == 1 and regions[0] != "001" else None


def country_name(region: str) -> str:
    example = phonenumbers.example_number(region)
    return geocoder.country_name_for_number(example, "en") if example else region


# Other names a picker may use for the same country. The library's English
# name is always accepted too.
_ALIASES: dict[str, tuple[str, ...]] = {
    "GB": ("united kingdom", "uk", "great britain", "britain"),
    "US": ("united states", "united states of america", "usa", "us"),
    "KR": ("south korea", "korea, republic of", "republic of korea", "korea"),
    "KP": ("north korea", "korea, democratic people's republic of"),
    "TR": ("turkey", "türkiye", "turkiye"),
    "CZ": ("czech republic", "czechia"),
    "RU": ("russia", "russian federation"),
    "AE": ("united arab emirates", "uae"),
    "IR": ("iran", "iran, islamic republic of"),
    "VN": ("vietnam", "viet nam"),
    "TW": ("taiwan", "taiwan, province of china"),
    "MD": ("moldova", "moldova, republic of"),
    "TZ": ("tanzania", "tanzania, united republic of"),
    "BO": ("bolivia", "bolivia, plurinational state of"),
    "VE": ("venezuela", "venezuela, bolivarian republic of"),
    "SY": ("syria", "syrian arab republic"),
    "LA": ("laos", "lao people's democratic republic"),
    "PS": ("palestine", "palestinian territories", "palestine, state of"),
    "CI": ("côte d'ivoire", "cote d'ivoire", "ivory coast"),
    "CD": ("congo (drc)", "democratic republic of the congo", "congo, the democratic republic of the"),
    "CG": ("congo (republic)", "republic of the congo", "congo"),
    "MK": ("north macedonia", "macedonia"),
    "SZ": ("eswatini", "swaziland"),
    "MM": ("myanmar", "myanmar (burma)", "burma"),
}


def _normalize(text: str) -> str:
    """Option text without flags, invisible marks, the dial code, bracketed
    native names or punctuation: "🇮🇱 Israel (ישראל) +972" → "israel"."""
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\+\s*[\d\s-]+", " ", text)
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] not in ("S", "C"))
    text = re.sub(r"[^\w\s,'’.-]", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip(" ,.-")


def _dial_digits(text: str) -> set[str]:
    return {re.sub(r"\D", "", m) for m in re.findall(r"\+\s*\d[\d\s-]{0,5}", text)}


def names_for(info: PhoneInfo) -> set[str]:
    return {_normalize(info.country_name), *_ALIASES.get(info.region, ())}


def match_country_option(options: list[str], info: PhoneInfo) -> int:
    """Index of the option for this phone's country, or -1.

    The option's name has to be one of the country's names, and if the
    option shows a dial code it has to be this one — the dial code alone
    isn't enough (+1 is the US and Canada, +44 the UK and Guernsey). Exactly
    one option must match; two matches is ambiguous and nothing is chosen.
    """
    names = names_for(info)
    want = info.dial_code.lstrip("+")
    hits = []
    for i, option in enumerate(options):
        codes = _dial_digits(option)
        if codes and want not in codes:
            continue
        if _normalize(option) in names:
            hits.append(i)
    return hits[0] if len(hits) == 1 else -1
