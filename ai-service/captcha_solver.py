import asyncio
import os

import httpx

TWOCAPTCHA_API_KEY = os.environ.get("TWOCAPTCHA_API_KEY", "")
_BASE = "https://2captcha.com"


async def solve_recaptcha_v2(site_key: str, page_url: str) -> str | None:
    if not TWOCAPTCHA_API_KEY:
        print("[captcha] No TWOCAPTCHA_API_KEY set")
        return None

    print(f"[captcha] Solving reCAPTCHA v2 sitekey={site_key[:20]}...")

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{_BASE}/in.php",
            data={
                "key": TWOCAPTCHA_API_KEY,
                "method": "userrecaptcha",
                "googlekey": site_key,
                "pageurl": page_url,
                "json": 1,
            },
        )
        data = resp.json()
        if data.get("status") != 1:
            print(f"[captcha] Submit failed: {data}")
            return None

        captcha_id = data["request"]
        print(f"[captcha] Submitted reCAPTCHA id={captcha_id}, polling...")

        for attempt in range(24):
            await asyncio.sleep(5)
            result = await client.get(
                f"{_BASE}/res.php",
                params={
                    "key": TWOCAPTCHA_API_KEY,
                    "action": "get",
                    "id": captcha_id,
                    "json": 1,
                },
            )
            data = result.json()
            if data.get("status") == 1:
                print("[captcha] reCAPTCHA v2 solved!")
                return data["request"]
            if data.get("request") != "CAPCHA_NOT_READY":
                print(f"[captcha] reCAPTCHA error: {data}")
                return None
            print(f"[captcha] Not ready, attempt {attempt + 1}/24")

    print("[captcha] reCAPTCHA timeout")
    return None


async def solve_hcaptcha(site_key: str, page_url: str) -> str | None:
    if not TWOCAPTCHA_API_KEY:
        return None

    print(f"[captcha] Solving hCaptcha sitekey={site_key[:20]}...")

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{_BASE}/in.php",
            data={
                "key": TWOCAPTCHA_API_KEY,
                "method": "hcaptcha",
                "sitekey": site_key,
                "pageurl": page_url,
                "json": 1,
            },
        )
        data = resp.json()
        if data.get("status") != 1:
            print(f"[captcha] hCaptcha submit failed: {data}")
            return None

        captcha_id = data["request"]
        print(f"[captcha] Submitted hCaptcha id={captcha_id}, polling...")

        for attempt in range(24):
            await asyncio.sleep(5)
            result = await client.get(
                f"{_BASE}/res.php",
                params={
                    "key": TWOCAPTCHA_API_KEY,
                    "action": "get",
                    "id": captcha_id,
                    "json": 1,
                },
            )
            data = result.json()
            if data.get("status") == 1:
                print("[captcha] hCaptcha solved!")
                return data["request"]
            if data.get("request") != "CAPCHA_NOT_READY":
                print(f"[captcha] hCaptcha error: {data}")
                return None
            print(f"[captcha] Not ready, attempt {attempt + 1}/24")

    print("[captcha] hCaptcha timeout")
    return None


async def _inject_recaptcha_token(page, token: str) -> None:
    await page.evaluate(
        """(token) => {
            const el = document.getElementById('g-recaptcha-response');
            if (el) el.value = token;
            if (typeof ___grecaptcha_cfg !== 'undefined') {
                Object.values(___grecaptcha_cfg.clients || {}).forEach(client => {
                    const cb = client?.['']['']['callback'];
                    if (typeof cb === 'function') cb(token);
                });
            }
        }""",
        token,
    )
    print("[captcha] reCAPTCHA token injected")


async def _inject_hcaptcha_token(page, token: str) -> None:
    await page.evaluate(
        """(token) => {
            document.querySelectorAll(
                '[name="h-captcha-response"], [name="g-recaptcha-response"]'
            ).forEach(el => { el.value = token; });
            if (window.hcaptcha) {
                try {
                    const id = Object.keys(
                        window.hcaptcha.__captchaApiReady || {}
                    )[0];
                    if (id !== undefined) window.hcaptcha.execute(id);
                } catch(e) {}
            }
        }""",
        token,
    )
    print("[captcha] hCaptcha token injected")


async def detect_and_solve_captcha(page) -> bool:
    """
    Detect and solve any visible captcha on the page using 2captcha.
    Returns True if captcha was solved (or none found), False on failure.
    Only targets visible user challenges — NOT reCAPTCHA v3 invisible.
    """
    page_url = page.url

    # reCAPTCHA v2 visible checkbox
    recaptcha = await page.query_selector(
        '.g-recaptcha[data-sitekey]:not([data-size="invisible"])'
    )
    if recaptcha:
        site_key = await recaptcha.get_attribute("data-sitekey")
        if site_key:
            token = await solve_recaptcha_v2(site_key, page_url)
            if token:
                await _inject_recaptcha_token(page, token)
                await page.wait_for_timeout(1000)
                return True
            print("[captcha] reCAPTCHA v2 could not be solved")
            return False

    # hCaptcha
    hcaptcha = await page.query_selector(
        'iframe[src*="hcaptcha.com"], div[data-hcaptcha-widget-id], .h-captcha[data-sitekey]'
    )
    if hcaptcha:
        site_key = await page.evaluate(
            "() => { const el = document.querySelector('[data-sitekey]'); "
            "return el ? el.getAttribute('data-sitekey') : null; }"
        )
        if site_key:
            token = await solve_hcaptcha(site_key, page_url)
            if token:
                await _inject_hcaptcha_token(page, token)
                await page.wait_for_timeout(1000)
                return True
            print("[captcha] hCaptcha could not be solved")
            return False

    return True  # no captcha found — not a failure
