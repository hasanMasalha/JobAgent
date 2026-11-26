"""CV.skills_json in every stored shape reads as a dict (utils/cv_skills.py).

A CV generated on 2026-09-27 stored a bare list of skill names; the daily
match raised AttributeError on it and skipped that user every run.
"""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from utils.cv_skills import cv_skills_json

CURRENT = {"skills": ["Python"], "years_experience": 4, "job_titles": ["Engineer"], "seniority_level": "mid"}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (CURRENT, CURRENT),
        (json.dumps(CURRENT), CURRENT),
        (["Python", "SQL", " ", 3], {"skills": ["Python", "SQL"]}),
        (json.dumps(["Python"]), {"skills": ["Python"]}),
        (None, {}),
        ("", {}),
        ("not json", {}),
        (42, {}),
    ],
)
def test_every_shape_reads_as_a_dict(raw, expected):
    assert cv_skills_json(raw) == expected


def test_match_jobs_takes_a_cv_whose_skills_are_a_list():
    """The real crash: match_jobs called skills_json.get(...) on the list."""
    from routes import matching

    conn = MagicMock()
    conn.fetchrow = AsyncMock(side_effect=[
        {"clean_summary": "Backend engineer.", "skills_json": json.dumps(["Python", "SQL"])},
        None,  # no JobPreference
    ])
    conn.close = AsyncMock()
    seen = {}

    def seniority(cv_data):
        seen.update(cv_data)
        return "mid"

    with (
        patch.dict("os.environ", {"DATABASE_URL": "postgres://test"}),
        patch.object(matching.asyncpg, "connect", AsyncMock(return_value=conn)),
        patch.object(matching, "_ensure_cache_table", AsyncMock()),
        patch.object(matching, "_get_db_cache", AsyncMock(return_value=None)),
        patch.object(matching, "_get_candidate_seniority", side_effect=seniority),
        patch.object(matching, "_vector_search", AsyncMock(return_value=[])),
    ):
        result = asyncio.run(matching.match_jobs(matching.MatchRequest(user_id="u1")))

    assert result == []
    assert seen["skills"] == ["Python", "SQL"]
