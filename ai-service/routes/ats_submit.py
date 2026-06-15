import base64
import sys
import traceback

from routes.ats_form_fill import fill_ats_form


def _detect_ats(url: str) -> str | None:
    """Detect ATS platform from job URL."""
    if not url:
        return None
    u = url.lower()
    if "greenhouse.io" in u:
        return "greenhouse"
    if "lever.co" in u:
        return "lever"
    if "workable.com" in u:
        return "workable"
    if "bamboohr.com" in u:
        return "bamboohr"
    if "comeet.com" in u:
        return "comeet"
    if "teamtailor.com" in u:
        return "teamtailor"
    if "ashbyhq.com" in u:
        return "ashby"
    return None


async def submit_via_ats(apply_url: str, ats_platform: str, user_data: dict) -> dict:
    """Submit application via Playwright form fill."""
    print("[ats-submit] ===== submit_via_ats called =====")
    print(f"[ats-submit] platform={ats_platform}")
    print(f"[ats-submit] url={apply_url}")
    try:
        cv_bytes = base64.b64decode(user_data["cv_base64"]) if user_data.get("cv_base64") else b""
        print(f"[ats-submit] cv_bytes length={len(cv_bytes)}")

        result = await fill_ats_form(
            apply_url=apply_url,
            first_name=user_data["first_name"],
            last_name=user_data["last_name"],
            email=user_data["email"],
            phone=user_data.get("phone", ""),
            cv_bytes=cv_bytes,
            cv_filename=user_data.get("cv_filename", "resume.pdf"),
            cover_letter=user_data.get("cover_letter", ""),
            linkedin_url=user_data.get("linkedin_url", ""),
        )
        print(f"[ats-submit] fill_ats_form returned: {result}")
        return result

    except Exception as e:
        print(f"[ats-submit] EXCEPTION: {type(e).__name__}: {e}")
        traceback.print_exc(file=sys.stdout)
        return {"success": False, "error": str(e)}
