import os
import threading
import time

from fastapi import APIRouter
from playwright.sync_api import sync_playwright

router = APIRouter()

# In-memory status map: user_id -> "pending" | "success" | "timeout" | "error"
_login_sessions: dict[str, str] = {}


def _profile_dir(user_id: str) -> str:
    return os.path.join("browser_profile", user_id)


def _has_saved_session(user_id: str) -> bool:
    """Check if the persistent profile directory has a Cookies file."""
    base = _profile_dir(user_id)
    return (
        os.path.exists(os.path.join(base, "Default", "Cookies"))
        or os.path.exists(os.path.join(base, "Cookies"))
        or (os.path.isdir(base) and any(os.scandir(base)))
    )


def _run_login_flow(user_id: str) -> None:
    """Open a visible browser, wait for the user to log in, then close.
    Uses sync_playwright in a plain thread — avoids asyncio subprocess
    incompatibility with uvicorn's event loop on Windows."""
    profile = _profile_dir(user_id)
    os.makedirs(profile, exist_ok=True)
    _login_sessions[user_id] = "pending"

    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                profile,
                headless=False,   # intentionally visible — user must type credentials
                args=["--no-sandbox", "--disable-setuid-sandbox"],
            )
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto("https://www.linkedin.com/login", timeout=20_000)

            # Poll until URL leaves the login/checkpoint pages (max 120 s)
            deadline = time.time() + 120
            while time.time() < deadline:
                time.sleep(2)
                url = page.url
                if (
                    "linkedin.com/login" not in url
                    and "linkedin.com/checkpoint" not in url
                    and "linkedin.com/authwall" not in url
                    and "linkedin.com" in url
                ):
                    _login_sessions[user_id] = "success"
                    ctx.close()
                    return

            _login_sessions[user_id] = "timeout"
            ctx.close()

    except Exception as exc:
        print(f"[linkedin_auth] login flow error for {user_id}: {exc}")
        _login_sessions[user_id] = "error"


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/linkedin/start-login")
async def start_login(payload: dict):
    user_id: str = payload.get("user_id", "")
    if not user_id:
        return {"status": "error", "detail": "user_id required"}

    if _login_sessions.get(user_id) == "pending":
        return {"status": "pending"}

    thread = threading.Thread(target=_run_login_flow, args=(user_id,), daemon=True)
    thread.start()
    return {"status": "started"}


@router.get("/linkedin/session-status/{user_id}")
async def session_status(user_id: str):
    in_memory = _login_sessions.get(user_id)
    connected = _has_saved_session(user_id) or in_memory == "success"
    return {
        "connected": connected,
        "login_status": in_memory,
    }
