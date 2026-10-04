"""Arbeitnow: recent jobs from all four country sites, the employer's ATS link
read from the /apply redirect (so Greenhouse / Lever / Ashby jobs are 'auto'),
and the site's country added to the location."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

import arbeitnow_fetcher as af

NOW = 1_800_000_000.0
HOUR = 3600


def _raw(slug, site="www.arbeitnow.com", hours_ago=1, **over):
    return {
        "slug": slug,
        "url": f"https://{site}/jobs/companies/acme/{slug}",
        "title": "Backend Engineer",
        "company_name": "Acme",
        "description": "<p>Build <b>APIs</b>.</p><ul><li>Python</li></ul>",
        "location": "Berlin",
        "remote": False,
        "created_at": int(NOW - hours_ago * HOUR),
        **over,
    }


@pytest.mark.parametrize(
    "url, expected",
    [
        (
            "https://job-boards.greenhouse.io/zetaglobal/jobs/6010293004?utm_source=arbeitnow.com&ref=arbeitnow.com",
            "https://job-boards.greenhouse.io/zetaglobal/jobs/6010293004",
        ),
        (
            "https://jobs.lever.co/jobgether/1f8c62e8/apply?utm_source=arbeitnow.ch",
            "https://jobs.lever.co/jobgether/1f8c62e8/apply",
        ),
        (
            "https://jobs.ashbyhq.com/lumai/89962881/application?utm_source=arbeitnow.co.uk&ref=arbeitnow.co.uk",
            "https://jobs.ashbyhq.com/lumai/89962881/application",
        ),
        # A Greenhouse board on the company's own site needs gh_jid.
        (
            "https://sumup.com/careers/positions/8862799002?gh_jid=8862799002&utm_source=arbeitnow.fr&ref=arbeitnow.fr",
            "https://sumup.com/careers/positions/8862799002?gh_jid=8862799002",
        ),
        (
            "https://ruhrdot-gmbh.jobs.personio.de/job/2812642?#apply?utm_source=arbeitnow.com&_pc=arbeitnow.com",
            "https://ruhrdot-gmbh.jobs.personio.de/job/2812642",
        ),
    ],
)
def test_clean_apply_url_drops_tracking_only(url, expected):
    assert af.clean_apply_url(url) == expected


@pytest.mark.parametrize(
    "site, location, remote, expected",
    [
        ("www.arbeitnow.com", "Berlin", False, "Berlin, Germany"),
        ("www.arbeitnow.co.uk", "London", False, "London, United Kingdom"),
        ("www.arbeitnow.co.uk", "United Kingdom", False, "United Kingdom"),
        ("www.arbeitnow.fr", "Paris, France", False, "Paris, France"),
        ("www.arbeitnow.ch", "", False, "Switzerland"),
        ("www.arbeitnow.com", "Munich", True, "Munich, Germany (Remote)"),
        ("www.arbeitnow.co.uk", "Remote", True, "Remote, United Kingdom"),
    ],
)
def test_location_gets_the_site_country(site, location, remote, expected):
    assert af.job_location(_raw("x", site=site, location=location, remote=remote)) == expected


def _client(pages_by_site):
    """pages_by_site: {site: [page1_jobs, page2_jobs, ...]}."""

    async def get(url, params=None, **_):
        site = url.split("/")[2]
        pages = pages_by_site.get(site, [])
        n = params["page"]
        data = pages[n - 1] if n <= len(pages) else []
        return MagicMock(
            status_code=200,
            json=lambda: {"data": data, "links": {"next": "x" if n < len(pages) else None}},
        )

    client = MagicMock()
    client.get = AsyncMock(side_effect=get)
    return client


def test_fetch_recent_reads_every_site_keeps_the_window_and_dedupes():
    shared = _raw("shared", site="www.arbeitnow.co.uk")
    client = _client({
        "www.arbeitnow.com": [[_raw("a"), shared, _raw("old", hours_ago=50)]],
        "www.arbeitnow.co.uk": [[shared, _raw("b", site="www.arbeitnow.co.uk")]],
        "www.arbeitnow.fr": [[_raw("c", site="www.arbeitnow.fr", hours_ago=25)]],
    })
    jobs = asyncio.run(af.fetch_recent(client, now=NOW))
    assert sorted(j["slug"] for j in jobs) == ["a", "b", "c", "shared"]


def test_fetch_recent_stops_at_a_page_with_nothing_recent():
    import arbeitnow_fetcher

    client = _client({
        "www.arbeitnow.com": [[_raw("a")], [_raw("old1", hours_ago=60)], [_raw("never-read")]],
    })
    sleep = AsyncMock()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(arbeitnow_fetcher.asyncio, "sleep", sleep)
        jobs = asyncio.run(af.fetch_recent(client, now=NOW))
    assert [j["slug"] for j in jobs] == ["a"]
    com_pages = [c.kwargs["params"]["page"] for c in client.get.call_args_list if "arbeitnow.com/" in c.args[0]]
    assert com_pages == [1, 2]


def _redirect(location):
    req = httpx.Request("GET", "https://www.arbeitnow.com/x/apply")
    return httpx.Response(302, headers={"location": location}, request=req)


def test_resolve_apply_url_reads_the_redirect():
    client = MagicMock()
    client.get = AsyncMock(return_value=_redirect("https://jobs.lever.co/acme/123/apply?utm_source=arbeitnow.com"))
    url = asyncio.run(af.resolve_apply_url(client, "https://www.arbeitnow.com/jobs/companies/acme/x"))
    assert url == "https://jobs.lever.co/acme/123/apply"
    assert client.get.call_args.args[0].endswith("/x/apply")
    assert client.get.call_args.kwargs["follow_redirects"] is False


def test_resolve_apply_url_none_when_it_stays_on_arbeitnow():
    client = MagicMock()
    client.get = AsyncMock(return_value=_redirect("https://www.arbeitnow.com/login"))
    assert asyncio.run(af.resolve_apply_url(client, "https://www.arbeitnow.com/jobs/x")) is None
    req = httpx.Request("GET", "https://www.arbeitnow.com/x/apply")
    client.get = AsyncMock(return_value=httpx.Response(200, request=req))
    assert asyncio.run(af.resolve_apply_url(client, "https://www.arbeitnow.com/jobs/x")) is None


def _too_many(retry_after=None):
    req = httpx.Request("GET", "https://www.arbeitnow.com/x/apply")
    headers = {"retry-after": retry_after} if retry_after else {}
    return httpx.Response(429, headers=headers, request=req)


def test_a_429_is_not_an_answer():
    client = MagicMock()
    client.get = AsyncMock(return_value=_too_many("30"))
    with pytest.raises(af.RateLimited) as e:
        asyncio.run(af.resolve_apply_url(client, "https://www.arbeitnow.com/jobs/x"))
    assert e.value.retry_after == 30


def test_resolve_all_backs_off_and_retries(monkeypatch):
    sleeps = []

    async def sleep(s):
        sleeps.append(s)

    monkeypatch.setattr(af.asyncio, "sleep", sleep)
    client = MagicMock()
    client.get = AsyncMock(side_effect=[
        _redirect("https://jobs.lever.co/acme/1/apply"),
        _too_many(),
        _redirect("https://jobs.lever.co/acme/2/apply"),
    ])
    out = asyncio.run(af.resolve_all(client, [_raw("a"), _raw("b")]))
    assert [a for _, a in out] == ["https://jobs.lever.co/acme/1/apply", "https://jobs.lever.co/acme/2/apply"]
    assert 60 in sleeps  # the first back-off
    assert sleeps.count(af.APPLY_DELAY_SECONDS) == 2  # paced between lookups


def test_resolve_all_stops_and_leaves_the_rest_when_still_refused(monkeypatch):
    monkeypatch.setattr(af.asyncio, "sleep", AsyncMock())
    client = MagicMock()
    client.get = AsyncMock(side_effect=[
        _redirect("https://jobs.lever.co/acme/1/apply"),
        _too_many(), _too_many(), _too_many(),
    ])
    out = asyncio.run(af.resolve_all(client, [_raw("a"), _raw("b"), _raw("c")]))
    assert [r["slug"] for r, _ in out] == ["a"]  # b and c not stored this run


def test_to_job_converts_html_and_keeps_the_arbeitnow_link():
    job = af.to_job(_raw("a"), "https://jobs.lever.co/acme/123/apply")
    assert "<" not in job["description"] and "APIs" in job["description"] and "Python" in job["description"]
    assert job["url"].startswith("https://www.arbeitnow.com/")
    assert job["apply_url"] == "https://jobs.lever.co/acme/123/apply"
    assert job["source"] == "arbeitnow"
    assert job["location"] == "Berlin, Germany"
    assert af.to_job(_raw("a", description="  "), None) is None


def test_ats_jobs_are_stored_auto_and_others_external():
    pytest.importorskip("asyncpg")
    from routes.jobs import _detect_apply_type

    ats = af.to_job(_raw("a", description="<p>Role</p>"), "https://job-boards.greenhouse.io/acme/jobs/1")
    personio = af.to_job(_raw("b", description="<p>Role</p>"), "https://acme.jobs.personio.de/job/1")
    none = af.to_job(_raw("c", description="<p>Role</p>"), None)
    assert _detect_apply_type(ats) == "auto"
    assert _detect_apply_type(personio) == "external"
    assert _detect_apply_type(none) == "external"
