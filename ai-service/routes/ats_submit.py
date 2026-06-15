import base64

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
    return None


async def submit_via_ats(apply_url: str, ats_platform: str, user_data: dict) -> dict:
    """Submit application via Playwright form fill."""
    cv_bytes = base64.b64decode(user_data["cv_base64"]) if user_data.get("cv_base64") else b""

    return await fill_ats_form(
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
