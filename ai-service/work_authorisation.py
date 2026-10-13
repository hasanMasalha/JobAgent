"""Work authorisation and sponsorship, answered for the country a question is about.

The user lists the countries where they can work now (`User.work_countries`,
ISO codes, plus "EU" for an EU citizen's free movement) and, of those, where
their right to work depends on a visa that will need an employer's sponsorship
later (`sponsorship_later_countries`). Decided 2026-10-13:
- "Authorised to work in X?" → Yes if X is on the list; No if it isn't, but
  only once the user has saved the list (`work_auth_confirmed_at`), because No
  rests on the list being complete.
- "Will you (now or in the future) require sponsorship in X?" → X not on the
  list: Yes. On it: Yes if it's in the sponsorship-later list, else No. A
  question about "currently" only: No for a country on the list.
- X is the country the question names, else the job's country (from
  `Job.location`). No country, several with different answers, or one we
  can't place → no answer (the application stops for the user). Never a guess.
- Until the list is saved, the old Israel-only answers (`work_authorized`,
  `requires_sponsorship`) are used for Israel and nothing else.

Until 2026-10-13 the Profile asked "Authorized to work in Israel?" and one
"Requires visa sponsorship?" with no country, which was typed into a
sponsorship question about any country.

The country data (`data/countries.json`) is shared with the Profile picker.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

EU = "EU"
# Where an EU citizen may work without a visa: the EU, the EEA and Switzerland.
EU_FREE_MOVEMENT = frozenset({
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT",
    "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH",
})

_DATA = json.loads((Path(__file__).parent / "data" / "countries.json").read_text(encoding="utf-8"))
COUNTRIES: dict[str, str] = {c["code"]: c["name"] for c in _DATA["countries"]}

_US_STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "hawaii": "HI",
    "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY",
    "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI",
    "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE",
    "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "georgia": "GA", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA",
    "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    "district of columbia": "DC",
}
_US_STATE_CODES = set(_US_STATES.values())

# Spellings → a country code, or None for a name that is more than one place
# ("Georgia": the country or the US state; "Europe": not one right to work).
_NAMES: dict[str, str | None] = {}
for _c in _DATA["countries"]:
    for _n in [_c["name"], *_c["aliases"]]:
        _NAMES[_n.lower()] = _c["code"]
for _state in _US_STATES:
    _NAMES[_state] = "US"
_NAMES.update({
    "georgia": None, "europe": None,
    # Places whose names contain a country's.
    "jersey city": "US", "new south wales": "AU", "new england": "US",
    "european union": EU, "european economic area": EU, "eea": EU,
})
# Case-sensitive abbreviations: "us" is also a word ("tell us").
_ABBREVIATIONS = {"US": "US", "U.S.": "US", "U.S": "US", "UK": "GB", "U.K.": "GB", "EU": EU, "EEA": EU}

# Longest first, so "Northern Ireland" isn't read as Ireland, "New Mexico" as
# Mexico or "Papua New Guinea" as Guinea.
_NAME_ORDER = sorted(_NAMES, key=len, reverse=True)
_HEBREW = re.compile(r"[֐-׿]")


def _name_pattern(name: str) -> re.Pattern:
    if _HEBREW.search(name):
        return re.compile(re.escape(name))  # Hebrew prefixes attach: "בישראל"
    return re.compile(r"(?<![a-z0-9])" + re.escape(name) + r"(?![a-z0-9])")


_NAME_PATTERNS = [(n, _name_pattern(n)) for n in _NAME_ORDER]
_ABBR_PATTERNS = [
    (code, re.compile(r"(?<![A-Za-z.])" + re.escape(a) + r"(?![A-Za-z])"))
    for a, code in sorted(_ABBREVIATIONS.items(), key=lambda kv: len(kv[0]), reverse=True)
]

_AMBIGUOUS = object()


def _countries_named(text: str) -> set | object:
    """The country codes a piece of text names, `_AMBIGUOUS` if it names a
    place that could be more than one, or an empty set."""
    found: set[str] = set()
    low = text.lower()
    for name, pattern in _NAME_PATTERNS:
        if pattern.search(low):
            code = _NAMES[name]
            if code is None:
                return _AMBIGUOUS
            found.add(code)
            low = pattern.sub(" ", low)
    for code, pattern in _ABBR_PATTERNS:
        if pattern.search(text):
            found.add(code)
    return found


# ── Job locations ────────────────────────────────────────────────────────────

# Cities that appear in job locations without a country.
_CITIES = {
    "tel aviv": "IL", "tel aviv-yafo": "IL", "tel-aviv": "IL", "jerusalem": "IL", "haifa": "IL",
    "herzliya": "IL", "ramat gan": "IL", "petah tikva": "IL", "petach tikva": "IL", "netanya": "IL",
    "raanana": "IL", "ra'anana": "IL", "kfar saba": "IL", "rehovot": "IL", "beer sheva": "IL",
    "yokneam": "IL", "holon": "IL", "rishon lezion": "IL", "merkaz": "IL",
    "new york": "US", "new york city": "US", "nyc": "US", "san francisco": "US", "los angeles": "US",
    "chicago": "US", "austin": "US", "seattle": "US", "boston": "US", "atlanta": "US", "denver": "US",
    "sunnyvale": "US", "palo alto": "US", "mountain view": "US", "san jose": "US", "dallas": "US",
    "london": "GB", "manchester": "GB", "edinburgh": "GB", "cambridge": "GB",
    "berlin": "DE", "munich": "DE", "münchen": "DE", "hamburg": "DE", "frankfurt": "DE", "cologne": "DE",
    "köln": "DE", "paris": "FR", "amsterdam": "NL", "dublin": "IE", "zurich": "CH", "zürich": "CH",
    "toronto": "CA", "vancouver": "CA", "sydney": "AU", "melbourne": "AU", "singapore": "SG",
    "dubai": "AE", "bangalore": "IN", "bengaluru": "IN", "mumbai": "IN", "tokyo": "JP", "lisbon": "PT",
    "prague": "CZ", "warsaw": "PL", "madrid": "ES", "barcelona": "ES", "kyiv": "UA", "kiev": "UA",
    "beijing": "CN", "shanghai": "CN", "seoul": "KR", "bangkok": "TH", "sofia": "BG", "sao paulo": "BR",
    "são paulo": "BR", "las vegas": "US", "salt lake city": "US", "hod hasharon": "IL", "yokne`am": "IL",
    "taipei": "TW", "buenos aires": "AR", "cordoba": "AR", "bogota": "CO", "bogotá": "CO", "medellin": "CO",
    "montreal": "CA", "montréal": "CA", "ottawa": "CA", "calgary": "CA", "edmonton": "CA", "waterloo": "CA",
    "mississauga": "CA", "quebec city": "CA", "hyderabad": "IN", "pune": "IN", "chennai": "IN",
    "delhi": "IN", "new delhi": "IN", "gurgaon": "IN", "gurugram": "IN", "noida": "IN", "stuttgart": "DE",
    "düsseldorf": "DE", "dusseldorf": "DE", "leipzig": "DE", "dresden": "DE", "jakarta": "ID",
    "casablanca": "MA", "panama city": "PA", "valletta": "MT",
}
# US state codes that are also the code of a country jobs are posted in.
# "City, CA" after a city's name is the US state — the US way of writing it;
# in the 2026-10-13 data every one was, except "Toronto, CA" — unless it's a
# city we know elsewhere. After a region code ("M, IL", "BY, DE") it's the
# country. "Home Office, DE" says neither. The other shared codes (VA Vatican,
# GA Gabon, MN Mongolia…) are always the US state.
_SHARED_CODES = {"IL", "DE", "CA", "IN", "CO", "AR", "PA", "MA", "ID", "MT"}
_GROUPS = re.compile(r";|\s+or\s+", re.IGNORECASE)  # "London, UK or Zurich, Switzerland"
_SPLIT = re.compile(r"\s+[-–]\s+|[,|/()]")
_NOISE = re.compile(r"\b(remote|hybrid|home ?office|office|hq|area|greater|metropolitan|job|location:?)\b", re.IGNORECASE)
_REGION_CODE = re.compile(r"[A-Z]{1,3}")


def _city(token: str) -> str | None:
    return _CITIES.get(_NOISE.sub("", token).strip(" :").lower())


def _place(tokens: list[str]) -> set[str] | None:
    """The countries of one place ("City, Region, Country", "City, ST",
    "Country"…). None when it can't be told."""
    last = tokens[-1]
    prev = tokens[-2] if len(tokens) > 1 else None
    # "Malta, MT, USA", "Lebanon, NJ, US": a US town; its name isn't the country.
    if prev and prev in _US_STATE_CODES and _countries_named(last) == {"US"}:
        return {"US"}
    if re.fullmatch(r"[A-Z]{2}", last):
        code = "GB" if last == "UK" else last
        if code in _US_STATE_CODES and (code not in COUNTRIES or code not in _SHARED_CODES):
            return {"US"}
        if code in _SHARED_CODES:
            # A region code before it ("M, IL", "Berlin, BE, DE") makes it the
            # country; after a city name ("Chicago, IL") only the city can say.
            if prev is None or _REGION_CODE.fullmatch(prev):
                return {code}
            city = _city(prev)
            if city:
                return {city}
            if not _NOISE.sub("", prev).strip(" :-"):
                return None
            return {"US"}
        if code in COUNTRIES:
            return {code}

    found: set[str] = set()
    for token in tokens:
        named = _countries_named(token)
        if named is not _AMBIGUOUS:
            found |= {c for c in named if c != EU}
    if not found:
        found = {c for c in (_city(t) for t in tokens) if c}
    return found or None


def job_countries(location: str | None) -> frozenset[str]:
    """The countries a job's location names. Empty when it can't be told
    ("Remote", a place we don't know, "Home Office, DE" — Germany or
    Delaware); several when it lists several."""
    text = (location or "").strip()
    if not text:
        return frozenset()
    if _HEBREW.search(text):  # Hebrew-language listings are Israeli job sites
        return frozenset({"IL"})

    found: set[str] = set()
    for group in _GROUPS.split(text):
        tokens = [t.strip() for t in _SPLIT.split(group) if t and t.strip()]
        if not tokens or not _NOISE.sub("", " ".join(tokens)).strip(" :-"):
            continue  # "Remote"
        place = _place(tokens)
        if place is None:
            return frozenset()  # one place we can't tell: not all of them
        found |= place
    return frozenset(found)


# ── Answers ─────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class WorkAuth:
    """The user's right to work, as they gave it."""

    countries: frozenset[str] = field(default_factory=frozenset)
    sponsorship_later: frozenset[str] = field(default_factory=frozenset)
    confirmed: bool = False  # work_auth_confirmed_at: the list is complete
    # The old Israel-only answers, used for Israel until the list is saved
    # (and only once the Application details were confirmed).
    legacy_israel: bool | None = None
    legacy_sponsorship: bool | None = None


_THIS_JOB = re.compile(
    r"\b(this|the) (country|location)\b|\bcountry (where|in which)\b|\bwhere (the|this) (job|role|position)\b"
)
_CURRENT_ONLY = re.compile(r"\b(currently|at this time|right now|at present|presently)\b")


def question_countries(label: str, jobs: frozenset[str]) -> frozenset[str] | None:
    """The countries a question is about: the ones it names, else the job's.
    None when that can't be told."""
    named = _countries_named(label or "")
    if named is _AMBIGUOUS:
        return None
    if named and not _THIS_JOB.search((label or "").lower()):
        return frozenset(named)
    return jobs or None


def _holding(auth: WorkAuth, code: str) -> str | None:
    """The list entry that lets the user work in `code`, if any."""
    if code in auth.countries:
        return code
    if code in EU_FREE_MOVEMENT and EU in auth.countries:
        return EU
    return None


def authorised(auth: WorkAuth, code: str) -> bool | None:
    if not auth.confirmed:
        return auth.legacy_israel if code == "IL" else None
    if code == EU:
        if EU in auth.countries:
            return True
        # Allowed in some member states isn't the EU as a whole.
        return None if auth.countries & EU_FREE_MOVEMENT else False
    return _holding(auth, code) is not None


def needs_sponsorship(auth: WorkAuth, code: str, current_only: bool) -> bool | None:
    if not auth.confirmed:
        return auth.legacy_sponsorship if code == "IL" else None
    allowed = authorised(auth, code)
    if allowed is None:
        return None
    if not allowed:
        return True
    if current_only:
        return False
    return (code if code == EU else _holding(auth, code)) in auth.sponsorship_later


def _same(values: list[bool | None]) -> bool | None:
    if not values or any(v is None for v in values) or len(set(values)) != 1:
        return None
    return values[0]


def authorisation_answer(label: str, auth: WorkAuth, jobs: frozenset[str]) -> bool | None:
    codes = question_countries(label, jobs)
    return _same([authorised(auth, c) for c in codes]) if codes else None


def sponsorship_answer(label: str, auth: WorkAuth, jobs: frozenset[str]) -> bool | None:
    codes = question_countries(label, jobs)
    if not codes:
        return None
    lab = (label or "").lower()
    current_only = bool(_CURRENT_ONLY.search(lab)) and "future" not in lab
    return _same([needs_sponsorship(auth, c, current_only) for c in codes])
