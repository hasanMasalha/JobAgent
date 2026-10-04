"""The scrape searches the default markets plus users' saved locations. Before
2026-10-04 it passed no location at all and got only US jobs."""
from urllib.parse import parse_qs, urlparse

from linkedin_fetcher import _search_url
from locations import DEFAULT_SCRAPE_LOCATIONS, ScrapeLocation, scrape_locations


def _names(locs):
    return [loc.linkedin for loc in locs]


def test_defaults_without_users():
    assert _names(scrape_locations([])) == DEFAULT_SCRAPE_LOCATIONS


def test_defaults_are_whole_countries_on_indeed():
    for loc in scrape_locations([]):
        assert loc.indeed_country
        assert loc.indeed_location is None


def test_user_country_is_added_once():
    names = _names(scrape_locations(["Canada", "canada", " Canada ", "Israel"]))
    assert names == [*DEFAULT_SCRAPE_LOCATIONS, "Canada"]


def test_city_in_a_searched_country_is_covered_by_it():
    assert _names(scrape_locations(["Tel Aviv", "London", "Berlin"])) == DEFAULT_SCRAPE_LOCATIONS


def test_city_elsewhere_is_searched_as_the_city():
    locs = scrape_locations(["Toronto"])
    assert locs[-1] == ScrapeLocation("Toronto", "canada", "Toronto")


def test_unknown_place_is_linkedin_only():
    locs = scrape_locations(["Haifa area"])
    assert locs[-1] == ScrapeLocation("Haifa area", None, None)


def test_onboarding_spellings():
    locs = scrape_locations(["UAE", "Remote"])
    assert locs[-1] == ScrapeLocation("UAE", "united arab emirates", None)
    assert "Remote" not in _names(locs)


def test_blank_and_none_are_ignored():
    assert _names(scrape_locations(["", "  ", None])) == DEFAULT_SCRAPE_LOCATIONS


def test_linkedin_url_carries_the_location():
    q = parse_qs(urlparse(_search_url("backend developer", "United Kingdom", 25)).query)
    assert q == {
        "keywords": ["backend developer"],
        "location": ["United Kingdom"],
        "f_TPR": ["r86400"],
        "start": ["25"],
    }
