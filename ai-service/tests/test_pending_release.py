"""pending_release: an application left with the extension (pending_extension)
past the timeout is released — manual, with the reason, and its credit back at
most once. Until 2026-10-12 a lost report left it pending and charged for good."""

import asyncio
from pathlib import Path

import pending_release
from pending_release import PENDING_EXTENSION_TIMEOUT_HOURS, release_stale_pending


class _Conn:
    """Answers the release UPDATE with `stale`; each application's charged
    flag is cleared at most once, like the conditional UPDATE."""

    def __init__(self, stale, charged):
        self.stale = stale
        self.charged = set(charged)
        self.calls = []

    def transaction(self):
        conn = self

        class _Tx:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *_):
                return False

        return _Tx()

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        return [{"id": i} for i in self.stale]

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        if "auto_apply_charged = false" in sql and args[0] in self.charged:
            self.charged.discard(args[0])
            return {"user_id": "u1"}
        return None

    async def execute(self, sql, *args):
        self.calls.append((sql, args))


def test_releases_stale_pending_as_manual_with_the_reason():
    conn = _Conn(stale=["a1", "a2"], charged=["a1"])
    assert asyncio.run(release_stale_pending(conn)) == ["a1", "a2"]
    sql, args = conn.calls[0]
    assert "status = 'manual'" in sql and "status = 'pending_extension'" in sql
    assert "applied_at < NOW() - make_interval(hours => $2)" in sql
    assert args == (pending_release.TIMED_OUT_MESSAGE, PENDING_EXTENSION_TIMEOUT_HOURS)
    assert pending_release.TIMED_OUT_MESSAGE.startswith("extension: timed_out")


def test_refunds_only_a_charged_one_once():
    conn = _Conn(stale=["a1", "a2"], charged=["a1"])
    asyncio.run(release_stale_pending(conn))
    usage = [c for c in conn.calls if 'UPDATE "UserUsage"' in c[0]]
    assert len(usage) == 1
    # Run again: a1's flag is already cleared, so nothing more is refunded.
    conn.calls.clear()
    asyncio.run(release_stale_pending(conn))
    assert not [c for c in conn.calls if 'UPDATE "UserUsage"' in c[0]]


def test_nothing_stale_does_nothing():
    conn = _Conn(stale=[], charged=[])
    assert asyncio.run(release_stale_pending(conn)) == []
    assert len(conn.calls) == 1


def test_timeout_matches_the_site():
    ts = (Path(__file__).resolve().parents[2] / "lib" / "extension-handover.ts").read_text(encoding="utf-8")
    assert f"PENDING_EXTENSION_TIMEOUT_HOURS = {PENDING_EXTENSION_TIMEOUT_HOURS};" in ts
