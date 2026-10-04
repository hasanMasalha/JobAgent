"""Active Jobs DB: fetched per market with location_filter, paged, capped, and
stored through upsert_job so every job gets an embedding. Until 2026-10-04 its
rows were written without one and never reached matching."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import active_jobs_fetcher as ajf
from locations import DEFAULT_SCRAPE_LOCATIONS


def _raw(i: int, **over) -> dict:
    return {
        "url": f"https://job-boards.greenhouse.io/acme/jobs/{i}",
        "title": f"Engineer {i}",
        "organization": "Acme",
        "locations_derived": ["Berlin, Germany"],
        "description_text": "Build things." * 10,
        **over,
    }


def test_to_job_maps_fields_and_uses_the_ats_url_to_apply():
    job = ajf.to_job(_raw(1))
    assert job == {
        "title": "Engineer 1",
        "company": "Acme",
        "description": "Build things." * 10,
        "location": "Berlin, Germany",
        "url": "https://job-boards.greenhouse.io/acme/jobs/1",
        "apply_url": "https://job-boards.greenhouse.io/acme/jobs/1",
        "source": "active_jobs_db",
        "salary_min": None,
        "salary_max": None,
    }


def test_to_job_skips_rows_without_url_or_description():
    assert ajf.to_job(_raw(1, url="")) is None
    assert ajf.to_job(_raw(1, description_text="  ")) is None
    assert ajf.to_job(_raw(1, locations_derived=None))["location"] == ""


def test_fetch_market_pages_until_a_short_page():
    pages = [[_raw(i) for i in range(100)], [_raw(i) for i in range(100, 130)]]
    fetch = AsyncMock(side_effect=pages)
    with patch.object(ajf, "fetch_active_jobs", fetch):
        jobs = asyncio.run(ajf.fetch_market(MagicMock(), "Germany", budget=500))
    assert len(jobs) == 130
    assert [c.kwargs["offset"] for c in fetch.call_args_list] == [0, 100]


def test_fetch_market_stops_at_the_budget():
    fetch = AsyncMock(side_effect=lambda client, loc, limit, offset: [_raw(offset + i) for i in range(limit)])
    with patch.object(ajf, "fetch_active_jobs", fetch):
        jobs = asyncio.run(ajf.fetch_market(MagicMock(), "Germany", budget=150))
    assert len(jobs) == 150
    assert [c.args[2] for c in fetch.call_args_list] == [100, 50]  # second page asks only for the rest


def test_request_uses_location_filter():
    client = MagicMock()
    client.get = AsyncMock(return_value=MagicMock(status_code=200, json=list))
    with patch.dict("os.environ", {"RAPIDAPI_KEY": "k"}):
        asyncio.run(ajf.fetch_active_jobs(client, "United States", 100, 200))
    params = client.get.call_args.kwargs["params"]
    assert params["location_filter"] == "United States"
    assert "location" not in params
    assert (params["limit"], params["offset"], params["time_frame"]) == (100, 200, "24h")


def test_every_market_gets_its_share_and_every_job_is_upserted():
    asked = {}

    async def fake_market(client, market, budget):
        asked[market] = budget
        return [_raw(hash(market) % 10_000 * 10 + i) for i in range(2)]

    upsert = AsyncMock(return_value=True)
    conn = MagicMock(close=AsyncMock())
    with (
        patch.dict("os.environ", {"RAPIDAPI_KEY": "k", "DATABASE_URL": "postgres://x"}),
        patch.object(ajf.asyncpg, "connect", AsyncMock(return_value=conn)),
        patch.object(ajf, "fetch_user_locations", AsyncMock(return_value=["Toronto"])),
        patch.object(ajf, "fetch_market", fake_market),
        patch("routes.jobs.upsert_job", upsert),
    ):
        result = asyncio.run(ajf.fetch_and_save_jobs(max_jobs=120))

    assert list(asked) == [*DEFAULT_SCRAPE_LOCATIONS, "Toronto"]
    assert set(asked.values()) == {20}  # 120 shared by 6 markets
    assert upsert.await_count == 12
    assert result["new"] == 12
    assert all(c.args[1]["source"] == "active_jobs_db" for c in upsert.call_args_list)


def test_no_key_does_nothing():
    with patch.dict("os.environ", {"RAPIDAPI_KEY": ""}):
        result = asyncio.run(ajf.fetch_and_save_jobs())
    assert result["new"] == 0 and "RAPIDAPI_KEY" in result["error"]
