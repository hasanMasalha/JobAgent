"""Where the daily LinkedIn and Indeed scrapes search.

The scrape covers a default set of markets plus every location users have
saved in JobPreference, so coverage grows with the users rather than being
fixed to one market. Before 2026-10-04 neither search passed a location:
LinkedIn answered for wherever the server's IP is and JobSpy defaulted Indeed
to the US, so every LinkedIn and Indeed job was American.
"""
from dataclasses import dataclass

from jobspy.model import Country

DEFAULT_SCRAPE_LOCATIONS = [
    "Israel",
    "United States",
    "United Kingdom",
    "Germany",
    "Netherlands",
]

# Well-known cities → their country. Matching uses it to let a city
# preference also match jobs tagged only with the country; the scrape uses it
# to pick the Indeed country for a city.
CITY_COUNTRY = {
    "tel aviv": "israel",
    "jerusalem": "israel",
    "haifa": "israel",
    "new york": "united states",
    "san francisco": "united states",
    "los angeles": "united states",
    "chicago": "united states",
    "austin": "united states",
    "seattle": "united states",
    "boston": "united states",
    "london": "united kingdom",
    "manchester": "united kingdom",
    "berlin": "germany",
    "munich": "germany",
    "paris": "france",
    "amsterdam": "netherlands",
    "dublin": "ireland",
    "toronto": "canada",
    "vancouver": "canada",
    "sydney": "australia",
    "melbourne": "australia",
    "singapore": "singapore",
    "dubai": "united arab emirates",
    "bangalore": "india",
    "bengaluru": "india",
    "mumbai": "india",
}

# Spellings users can save that JobSpy doesn't know (onboarding offers "UAE").
_COUNTRY_ALIASES = {
    "uae": "united arab emirates",
    "england": "united kingdom",
    "great britain": "united kingdom",
}

# Saved as a location (onboarding lists it with the countries) but not a place.
_NOT_A_PLACE = {"remote", "anywhere", "worldwide"}


@dataclass(frozen=True)
class ScrapeLocation:
    # Sent to LinkedIn's search as-is.
    linkedin: str
    # JobSpy's country_indeed; None when the country can't be told, and then
    # Indeed is skipped for this location rather than defaulting to the US.
    indeed_country: str | None
    # JobSpy's location within that country; None searches the whole country.
    indeed_location: str | None


def _country(name: str) -> str | None:
    """The JobSpy country for a country name, or None if it isn't one."""
    key = _COUNTRY_ALIASES.get(name, name)
    try:
        Country.from_string(key)
    except ValueError:
        return None
    return key


def scrape_locations(user_locations: list[str]) -> list[ScrapeLocation]:
    """The defaults plus the users' saved locations, one search each.

    A city whose country is already searched is dropped: the country search
    already returns it. Other cities are searched on their own, so a user in
    Toronto doesn't pull in all of Canada.
    """
    wanted: dict[str, str] = {}
    for raw in [*DEFAULT_SCRAPE_LOCATIONS, *user_locations]:
        name = " ".join((raw or "").split())
        key = name.lower()
        if key and key not in _NOT_A_PLACE and key not in wanted:
            wanted[key] = name

    countries = {c for c in (_country(k) for k in wanted) if c}

    result = []
    for key, name in wanted.items():
        country = _country(key)
        if country:
            result.append(ScrapeLocation(name, country, None))
            continue
        city_country = CITY_COUNTRY.get(key)
        if city_country in countries:
            continue
        result.append(ScrapeLocation(name, city_country, name if city_country else None))
    return result


async def fetch_user_locations(conn) -> list[str]:
    """Every distinct location saved in JobPreference."""
    rows = await conn.fetch(
        """
        SELECT DISTINCT trim(l) AS location
        FROM "JobPreference", unnest(locations) AS l
        WHERE trim(COALESCE(l, '')) <> ''
        """
    )
    return [r["location"] for r in rows]
