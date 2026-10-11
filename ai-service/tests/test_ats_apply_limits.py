"""ATS form filling: a debug screenshot can't fail an application, and only a
few forms are filled at once (2026-10-11: eleven side-by-side headed browsers
timed out taking screenshots and reading forms)."""

import asyncio
import threading
import time

from routes import ats_apply
from routes.ats_form_fill import _debug_screenshot


class _Page:
    def __init__(self, error=None):
        self.error = error

    async def screenshot(self, **_kwargs):
        if self.error:
            raise self.error


def test_debug_screenshot_failure_is_ignored(monkeypatch):
    monkeypatch.setattr("os.makedirs", lambda *a, **k: None)
    assert asyncio.run(_debug_screenshot(_Page(TimeoutError("Page.screenshot: Timeout 30000ms exceeded")), "ats_load")) is None
    path = asyncio.run(_debug_screenshot(_Page(), "post_submit"))
    assert path.startswith("/app/screenshots/post_submit_")


class _Conn:
    def transaction(self):
        conn = self

        class _Tx:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *_):
                return False

        return _Tx()

    async def execute(self, *_a):
        pass

    async def fetchrow(self, *_a):
        return None

    async def close(self):
        pass


def test_only_max_browsers_forms_are_filled_at_once(monkeypatch):
    lock = threading.Lock()
    active = {"now": 0, "max": 0}

    async def fake_submit(**_kwargs):
        with lock:
            active["now"] += 1
            active["max"] = max(active["max"], active["now"])
        await asyncio.sleep(0.05)
        with lock:
            active["now"] -= 1
        return {"success": False, "error": "missing_answers", "message": "m"}

    async def fake_connect(*_a, **_k):
        return _Conn()

    async def no_email(*_a, **_k):
        return None

    from routes import ats_submit
    monkeypatch.setattr(ats_submit, "submit_via_ats", fake_submit)
    monkeypatch.setattr(ats_apply.asyncpg, "connect", fake_connect)
    monkeypatch.setattr(ats_apply, "_send_application_confirmation_email", no_email)
    monkeypatch.setattr(ats_apply, "_browser_slots", threading.BoundedSemaphore(2))
    monkeypatch.setenv("DATABASE_URL", "postgres://test")

    request = {"ats_platform": "greenhouse", "apply_url": "https://boards.greenhouse.io/a/jobs/1",
               "application_id": "app-1", "user_data": {"cv_base64": ""}}
    threads = [threading.Thread(target=ats_apply._run_ats_apply_sync, args=(dict(request),)) for _ in range(6)]
    start = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert all(not t.is_alive() for t in threads)
    assert active["max"] == 2
    # Six fills of 0.05s, two at a time: at least three rounds.
    assert time.monotonic() - start >= 0.15
