import asyncio
from unittest.mock import AsyncMock, patch

import pandas as pd

from company_scraper import is_israeli_job


def test_is_israeli_job_accepts_israeli_location():
    assert is_israeli_job({"location": "Tel Aviv"}) is True


def test_is_israeli_job_accepts_hebrew_location():
    assert is_israeli_job({"location": "תל אביב"}) is True


def test_is_israeli_job_rejects_non_israeli_location():
    assert is_israeli_job({"location": "New York"}) is False


def test_is_israeli_job_rejects_london():
    assert is_israeli_job({"location": "London, UK"}) is False


def test_scrape_israel_jobs_returns_list():
    empty_df = pd.DataFrame(columns=["job_url", "title", "company", "description",
                                      "location", "site", "min_amount", "max_amount"])

    async def _run():
        with (
            patch("scraper.scrape_jobs", return_value=empty_df),
            patch("scraper.fetch_all_linkedin_jobs", new_callable=AsyncMock, return_value=[]),
            patch("scraper.scrape_drushim", new_callable=AsyncMock, return_value=[]),
            patch("scraper.scrape_alljobs", new_callable=AsyncMock, return_value=[]),
            patch("scraper.scrape_all_company_careers", new_callable=AsyncMock, return_value=[]),
        ):
            from scraper import scrape_israel_jobs
            return await scrape_israel_jobs()

    result = asyncio.run(_run())
    assert isinstance(result, list)
