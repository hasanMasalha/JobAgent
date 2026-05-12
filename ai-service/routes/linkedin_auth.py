import asyncio
import os
import threading
from urllib.parse import urlparse

from fastapi import APIRouter
from playwright.async_api import async_playwright

router = APIRouter()

# In-memory status map: user_id -> "pending" | "success" | "timeout" | "error"
_login_sessions: dict[str, str] = {}
_login_threads: dict[str, threading.Thread] = {}


def _profile_dir(user_id: str) -> str:
    return os.path.join("browser_profile", user_id)


def _has_saved_session(user_id: str) -> bool:
    """Return True only when a non-empty Cookies file exists in the profile."""
    base = _profile_dir(user_id)
    if not os.path.isdir(base):
        return False
    # Chromium 120+ writes cookies to Default/Network/Cookies; older builds use
    # Default/Cookies or Cookies at the root.  Check all three, require >1 KB so
    # a freshly-created but empty file doesn't produce a false positive.
    cookie_paths = [
        os.path.join(base, "Default", "Network", "Cookies"),
        os.path.join(base, "Default", "Cookies"),
        os.path.join(base, "Cookies"),
    ]
    for cookie_path in cookie_paths:
        if os.path.exists(cookie_path) and os.path.getsize(cookie_path) > 1024:
            return True
    return False


def _is_logged_in_url(url: str) -> bool:
    """Check the URL path only (not query string) for login-success indicators.

    Checking the full URL string caused false positives: LinkedIn's login-wall
    redirect appends '/feed' as a query parameter, so 'feed in url' matched
    even when the browser was on the login page.
    """
    try:
        path = urlparse(url).path.lower()
    except Exception:
        return False
    logged_out = ["/login", "/uas/login", "/checkpoint", "/authwall", "/signup", "/registration"]
    logged_in = ["/feed", "/in/", "/mynetwork", "/jobs", "/messaging", "/notifications", "/home"]
    if any(p in path for p in logged_out):
        return False
    return any(path.startswith(p) for p in logged_in)


async def start_linkedin_login(user_id: str) -> dict:
    profile_dir = f"browser_profile/{user_id}"
    os.makedirs(profile_dir, exist_ok=True)

    async with async_playwright() as p:
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

        # Close tabs restored from the previous session — they have LinkedIn URLs
        # that would trigger a false-positive login detection immediately.
        for restored in list(context.pages):
            try:
                await restored.close()
            except Exception:
                pass

        page = await context.new_page()

        # When LinkedIn opens a popup (Google OAuth),
        # bring it to front so the user can interact with it.
        async def handle_new_page(new_page):
            print(f"Popup detected: {new_page.url}")
            await new_page.bring_to_front()
            try:
                await new_page.wait_for_load_state('domcontentloaded', timeout=10000)
            except Exception:
                pass

        context.on('page', lambda pg: asyncio.ensure_future(handle_new_page(pg)))

        await page.goto('https://www.linkedin.com/login', wait_until='domcontentloaded')
        await page.bring_to_front()

        print("LinkedIn login page open — waiting for user...")

        timeout = 120
        elapsed = 0

        while elapsed < timeout:
            await asyncio.sleep(2)
            elapsed += 2

            try:
                current_url = page.url
                print(f"[login] elapsed={elapsed}s url={current_url}")

                if _is_logged_in_url(current_url):
                    print(f"[login] success detected at: {current_url}")
                    await asyncio.sleep(3)
                    await context.close()
                    return {'status': 'success', 'message': 'LinkedIn connected successfully'}

                # Also check all context pages — LinkedIn may redirect via a popup
                for ctx_page in context.pages:
                    try:
                        if _is_logged_in_url(ctx_page.url):
                            print(f"[login] success on ctx page: {ctx_page.url}")
                            await asyncio.sleep(3)
                            await context.close()
                            return {'status': 'success', 'message': 'LinkedIn connected successfully'}
                    except Exception:
                        continue

            except Exception as e:
                print(f"[login] poll error: {e}")
                continue

        await context.close()
        return {'status': 'timeout', 'message': 'Login not completed within 2 minutes'}


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

    # Clear stale error/timeout so the user can retry without hitting
    # "Something went wrong" immediately on a subsequent attempt.
    if _login_sessions.get(user_id) in ("error", "timeout"):
        _login_sessions.pop(user_id, None)

    # If a thread is genuinely still running, don't start another.
    existing = _login_threads.get(user_id)
    if existing and existing.is_alive():
        return {"status": "already_pending"}

    thread = threading.Thread(target=_run_login_flow, args=(user_id,), daemon=True)
    _login_threads[user_id] = thread
    thread.start()
    return {"status": "started"}


@router.post("/linkedin/force-connected")
async def force_connected(payload: dict):
    """Manual fallback: mark the session as connected without Playwright validation.

    Called when the user has logged in but automatic detection failed.
    Trusts the user — no browser check performed.
    """
    user_id: str = payload.get("user_id", "")
    if not user_id:
        return {"status": "error", "detail": "user_id required"}
    _login_sessions[user_id] = "success"
    print(f"[force-connected] {user_id} manually marked as connected")
    return {"status": "ok"}


@router.get("/linkedin/login-poll/{user_id}")
async def login_poll(user_id: str):
    """Fast in-memory check for the polling loop during an active login flow.

    Returns only the in-memory login_status — no Playwright, no disk I/O.
    The profile page polls this every 3 s while the headed login browser is open
    so the heavy session-status endpoint never runs concurrently with the login.
    """
    status = _login_sessions.get(user_id)
    connected = status == "success"
    return {"connected": connected, "login_status": status}


def _run_session_check(user_id: str) -> dict:
    """Run the headless Playwright session check in its own event loop.

    Playwright uses asyncio.create_subprocess_exec internally which raises
    NotImplementedError when called directly inside uvicorn's Windows event
    loop.  Running it in a thread with asyncio.run() gives it a fresh loop
    that supports subprocesses on all platforms.
    """
    async def _check() -> dict:
        profile_dir = _profile_dir(user_id)
        async with async_playwright() as p:
            context = await p.chromium.launch_persistent_context(
                user_data_dir=profile_dir,
                headless=True,
                args=['--no-sandbox', '--disable-setuid-sandbox'],
            )
            page = await context.new_page()
            await page.goto(
                'https://www.linkedin.com/feed',
                wait_until='domcontentloaded',
                timeout=15000,
            )
            await page.wait_for_timeout(2000)
            is_valid = _is_logged_in_url(page.url)
            print(f"[session-status] {user_id}: {'valid' if is_valid else 'expired'} ({page.url})")
            await context.close()

            if not is_valid:
                for cookie_file in [
                    os.path.join(profile_dir, "Default", "Network", "Cookies"),
                    os.path.join(profile_dir, "Default", "Cookies"),
                ]:
                    if os.path.exists(cookie_file):
                        try:
                            os.remove(cookie_file)
                            print(f"[session-status] cleared expired cookies: {cookie_file}")
                        except Exception:
                            pass
                return {"connected": False, "login_status": "expired"}

            return {"connected": True, "login_status": _login_sessions.get(user_id)}

    try:
        return asyncio.run(_check())
    except Exception as e:
        print(f"[session-status] check failed for {user_id}: {e}")
        return {"connected": False, "login_status": "check_failed"}


@router.get("/linkedin/session-status/{user_id}")
async def session_status(user_id: str):
    """Real session validation via headless Playwright (runs in a thread).

    Clears the saved cookies when the session has expired so that the profile
    page stops showing "Connected" after the user's LinkedIn session goes stale.
    Skips the Playwright check if a login is already in progress to avoid two
    browsers competing for the same profile directory.
    """
    in_memory = _login_sessions.get(user_id)

    # Login just completed in this process — trust in-memory state.
    if in_memory == "success":
        return {"connected": True, "login_status": in_memory}

    # Login is in progress — don't launch a second browser against the same
    # profile directory.
    if in_memory == "pending":
        return {"connected": False, "login_status": in_memory}

    profile_dir = _profile_dir(user_id)
    if not os.path.isdir(profile_dir):
        return {"connected": False, "login_status": None}

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _run_session_check, user_id)
