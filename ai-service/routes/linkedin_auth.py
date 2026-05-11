import asyncio
import os
import threading

from fastapi import APIRouter
from playwright.async_api import async_playwright

router = APIRouter()

# In-memory status map: user_id -> "pending" | "success" | "timeout" | "error"
_login_sessions: dict[str, str] = {}
_login_threads: dict[str, threading.Thread] = {}


def _profile_dir(user_id: str) -> str:
    return os.path.join("browser_profile", user_id)


def _has_saved_session(user_id: str) -> bool:
    """True if the profile has a Cookies file — Chromium 120+ uses Default/Network/Cookies."""
    base = _profile_dir(user_id)
    return (
        os.path.exists(os.path.join(base, "Default", "Network", "Cookies"))
        or os.path.exists(os.path.join(base, "Default", "Cookies"))
        or os.path.exists(os.path.join(base, "Cookies"))
    )


async def start_linkedin_login(user_id: str) -> dict:
    profile_dir = f"browser_profile/{user_id}"
    os.makedirs(profile_dir, exist_ok=True)

    async with async_playwright() as p:
        # Use persistent context so session is saved automatically
        context = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
            ignore_default_args=['--enable-automation'],
            user_agent=(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/120.0.0.0 Safari/537.36'
            ),
            viewport={'width': 1280, 'height': 800},
        )

        # Close any tabs restored from the previous session so they can't
        # trigger a false-positive "already logged in" detection below.
        for restored in list(context.pages):
            try:
                await restored.close()
            except Exception:
                pass

        page = await context.new_page()

        # When LinkedIn opens a popup (Google OAuth),
        # Playwright captures it here and brings it to focus
        async def handle_new_page(new_page):
            print(f"Popup detected: {new_page.url}")
            # Bring popup to front so user can see and interact
            await new_page.bring_to_front()
            # Wait for it to fully load
            try:
                await new_page.wait_for_load_state(
                    'domcontentloaded',
                    timeout=10000
                )
            except Exception:
                pass

        # Listen for ANY new page/popup opened by LinkedIn
        context.on('page', lambda pg: asyncio.ensure_future(
            handle_new_page(pg)
        ))

        # Navigate to LinkedIn login
        await page.goto(
            'https://www.linkedin.com/login',
            wait_until='domcontentloaded'
        )
        await page.bring_to_front()

        print("LinkedIn login page open — waiting for user...")

        # Poll only the main login page — not popups.
        # Google OAuth opens a popup whose URL contains "linkedin.com" as a
        # query parameter (origin=), which caused false-positive matches when
        # we iterated over all context.pages. Only the main page redirects to
        # /feed after a successful login.
        timeout = 120
        elapsed = 0

        while elapsed < timeout:
            await asyncio.sleep(2)
            elapsed += 2

            try:
                current_url = page.url
                login_success = (
                    'linkedin.com/feed' in current_url or
                    'linkedin.com/in/' in current_url or
                    'linkedin.com/mynetwork' in current_url or
                    'linkedin.com/jobs' in current_url or
                    'linkedin.com/messaging' in current_url or
                    'linkedin.com/notifications' in current_url or
                    'linkedin.com/home' in current_url
                )

                if login_success:
                    print(f"Login detected: {current_url}")
                    await asyncio.sleep(2)
                    await context.close()
                    return {
                        'status': 'success',
                        'message': 'LinkedIn connected successfully'
                    }

            except Exception:
                pass

        # Timeout reached
        await context.close()
        return {
            'status': 'timeout',
            'message': 'Login not completed within 2 minutes'
        }


def _run_login_flow(user_id: str) -> None:
    """Run async login in a dedicated event loop (thread-safe, avoids uvicorn loop conflicts)."""
    _login_sessions[user_id] = "pending"
    try:
        result = asyncio.run(start_linkedin_login(user_id))
        if _login_sessions.get(user_id) != "success":
            _login_sessions[user_id] = result.get("status", "error")
    except Exception as exc:
        print(f"[linkedin_auth] login flow error for {user_id}: {exc}")
        if _login_sessions.get(user_id) != "success":
            _login_sessions[user_id] = "error"


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/linkedin/start-login")
async def start_login(payload: dict):
    user_id: str = payload.get("user_id", "")
    if not user_id:
        return {"status": "error", "detail": "user_id required"}

    # Only block if a thread is genuinely still running — stale "pending" from a
    # crashed/timed-out thread must not prevent a new browser from opening.
    existing = _login_threads.get(user_id)
    if existing and existing.is_alive():
        return {"status": "pending"}

    thread = threading.Thread(target=_run_login_flow, args=(user_id,), daemon=True)
    _login_threads[user_id] = thread
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
