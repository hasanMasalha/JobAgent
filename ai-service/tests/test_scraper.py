import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd

from company_scraper import is_israeli_job
from locations import scrape_locations


def test_is_israeli_job_accepts_israeli_location():
    assert is_israeli_job({"location": "Tel Aviv"}) is True


def test_is_israeli_job_accepts_hebrew_location():
    assert is_israeli_job({"location": "תל אביב"}) is True


def test_is_israeli_job_rejects_non_israeli_location():
    assert is_israeli_job({"location": "New York"}) is False


def test_is_israeli_job_rejects_london():
    assert is_israeli_job({"location": "London, UK"}) is False


def _run_scrape(locations):
    empty_df = pd.DataFrame(columns=["job_url", "title", "company", "description",
                                      "location", "site", "min_amount", "max_amount"])
    indeed = MagicMock(return_value=empty_df)
    linkedin = AsyncMock(return_value=[])

    async def _run():
        with (
            patch("scraper.scrape_jobs", indeed),
            patch("scraper.fetch_all_linkedin_jobs", linkedin),
            patch("scraper.scrape_drushim", new_callable=AsyncMock, return_value=[]),
            patch("scraper.scrape_alljobs", new_callable=AsyncMock, return_value=[]),
            patch("scraper.scrape_all_company_careers", new_callable=AsyncMock, return_value=[]),
            patch("scraper.asyncio.sleep", new_callable=AsyncMock),
        ):
            from scraper import scrape_all_jobs
            return await scrape_all_jobs(locations)

    return asyncio.run(_run()), indeed, linkedin


def test_scrape_all_jobs_returns_list():
    result, _, _ = _run_scrape(scrape_locations([]))
    assert isinstance(result, list)


def test_every_indeed_search_names_a_country():
    # Without country_indeed JobSpy searches the US.
    _, indeed, _ = _run_scrape(scrape_locations(["Toronto", "Somewhere Unknown"]))
    searched = {(c.kwargs["country_indeed"], c.kwargs["location"]) for c in indeed.call_args_list}
    assert ("israel", None) in searched
    assert ("canada", "Toronto") in searched
    assert all(country for country, _ in searched)
    assert not any(loc == "Somewhere Unknown" for _, loc in searched)


def test_linkedin_gets_every_location():
    _, _, linkedin = _run_scrape(scrape_locations(["Toronto", "Somewhere Unknown"]))
    searched = linkedin.call_args.args[0]
    assert "Israel" in searched
    assert "Toronto" in searched
    assert "Somewhere Unknown" in searched
