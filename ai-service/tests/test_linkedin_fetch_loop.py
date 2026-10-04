"""The LinkedIn search loop: every results page searches the market it was
asked for, jobs already stored skip the detail visit, and a job returned by
several searches in one run is visited once."""
import asyncio
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import linkedin_fetcher
from scrape_timing import PhaseTimer


def _card(job_id: int, location: str) -> str:
    return (
        '<div class="base-card job-search-card">'
        f'<a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/engineer-{job_id}?trk=x"></a>'
        '<h3 class="base-search-card__title">Engineer</h3>'
        '<h4 class="base-search-card__subtitle">Acme</h4>'
        '<div class="base-search-card__metadata">'
        f'<span class="job-search-card__location">{location}</span>'
        "<time>1 hour ago</time></div></div>"
    )


class FakePage:
    """Three full results pages; each card's location differs from the
    search location, as LinkedIn's do ("New York, NY" in a US search)."""

    def __init__(self, first_id: int = 4012340000):
        self.searched: list[str] = []
        self.url = ""
        self.first_id = first_id

    async def goto(self, url, **_):
        self.url = url
        if "/jobs/search" in url:
            self.searched.append(url)

    async def wait_for_timeout(self, _ms):
        pass

    async def content(self):
        start = int(parse_qs(urlparse(self.url).query).get("start", ["0"])[0])
        return "".join(_card(self.first_id + start + i, "New York, NY") for i in range(10))

    async def close(self):
        pass


class FakeContext:
    def __init__(self, page):
        self.page = page

    async def new_page(self):
        return self.page


def _run(page, known=None, handled=None, timer=None):
    async def go():
        with (
            patch.object(linkedin_fetcher, "_fetch_full_description", AsyncMock(return_value="d" * 200)),
            patch.object(linkedin_fetcher, "extract_ats_url", AsyncMock(return_value=None)),
            patch.object(linkedin_fetcher, "get_linkedin_session_path", return_value=None),
            patch.object(linkedin_fetcher.asyncio, "sleep", AsyncMock()),
        ):
            return await linkedin_fetcher.fetch_linkedin_jobs_for_term(
                "backend developer", "United Kingdom", FakeContext(page),
                known=known, timer=timer, handled=handled,
            )

    return asyncio.run(go())


def test_every_results_page_searches_the_requested_location():
    page = FakePage()
    _run(page)
    assert len(page.searched) == 3
    for url in page.searched:
        assert parse_qs(urlparse(url).query)["location"] == ["United Kingdom"]


def test_jobs_keep_the_card_location():
    jobs = _run(FakePage())
    assert {j["location"] for j in jobs} == {"New York, NY"}


def test_stored_jobs_skip_the_detail_visit():
    known = {"4012340000": "https://www.linkedin.com/jobs/view/engineer-4012340000", "4012340025": "stored-4012340025"}
    timer = PhaseTimer()
    with patch.object(linkedin_fetcher, "_fetch_full_description", AsyncMock(return_value="d" * 200)) as fetch:
        async def go():
            with (
                patch.object(linkedin_fetcher, "extract_ats_url", AsyncMock(return_value=None)),
                patch.object(linkedin_fetcher, "get_linkedin_session_path", return_value=None),
                patch.object(linkedin_fetcher.asyncio, "sleep", AsyncMock()),
            ):
                return await linkedin_fetcher.fetch_linkedin_jobs_for_term(
                    "backend developer", "United Kingdom", FakeContext(FakePage()), known=known, timer=timer
                )

        jobs = asyncio.run(go())

    seen = [j for j in jobs if j.get("known")]
    assert {j["url"] for j in seen} == {"https://www.linkedin.com/jobs/view/engineer-4012340000", "stored-4012340025"}
    assert all(j["location"] == "New York, NY" for j in seen)
    assert fetch.await_count == 28  # 30 cards, 2 already stored
    skipped = [r for r in timer.rows() if r["phase"] == "linkedin: known, detail skipped"]
    assert skipped[0]["items"] == 2


def test_a_job_from_an_earlier_search_is_not_visited_again():
    handled: set[str] = set()
    first = _run(FakePage(), handled=handled)
    second = _run(FakePage(), handled=handled)  # same 30 job ids
    assert len(first) == 30
    assert second == []


def test_timer_records_search_pages_and_detail_visits():
    timer = PhaseTimer()
    _run(FakePage(), timer=timer)
    by_phase = {r["phase"]: r for r in timer.rows()}
    assert by_phase["linkedin: search pages"]["items"] == 3
    assert by_phase["linkedin detail: description"]["items"] == 30
    assert by_phase["linkedin: search pages"]["location"] == "United Kingdom"
