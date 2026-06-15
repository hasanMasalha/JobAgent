import base64
import re

import httpx


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


async def submit_greenhouse(
    apply_url: str,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    cv_base64: str,
    cv_filename: str,
    cover_letter: str,
    linkedin_url: str = "",
) -> dict:
    """Submit application to Greenhouse via public candidate API."""
    match = re.search(r"greenhouse\.io/([^/]+)/jobs/(\d+)", apply_url, re.IGNORECASE)
    if not match:
        return {"success": False, "error": "Cannot parse Greenhouse URL"}

    company = match.group(1)
    job_id = match.group(2)
    url = f"https://boards-api.greenhouse.io/v1/boards/{company}/jobs/{job_id}"

    cover_letter_b64 = base64.b64encode(cover_letter.encode("utf-8")).decode("ascii")

    payload = {
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "phone": phone,
        "resume_content": cv_base64,
        "resume_content_filename": cv_filename,
        "cover_letter_content": cover_letter_b64,
        "cover_letter_content_filename": "cover_letter.txt",
        "linkedin_profile_url": linkedin_url,
        "question_answers": [],
    }

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://boards.greenhouse.io",
        "Referer": apply_url,
    }

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code in (200, 201):
            return {"success": True, "ats": "greenhouse"}
        return {
            "success": False,
            "error": f"Greenhouse returned {resp.status_code}: {resp.text[:300]}",
        }


async def submit_lever(
    apply_url: str,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    cv_bytes: bytes,
    cv_filename: str,
    cover_letter: str,
    linkedin_url: str = "",
    github_url: str = "",
) -> dict:
    """Submit application to Lever via public apply endpoint (multipart)."""
    match = re.search(r"lever\.co/([^/]+)/([a-f0-9-]+)", apply_url, re.IGNORECASE)
    if not match:
        return {"success": False, "error": "Cannot parse Lever URL"}

    company = match.group(1)
    posting_id = match.group(2)
    endpoint = f"https://jobs.lever.co/{company}/{posting_id}/apply"

    files = {"resume": (cv_filename, cv_bytes, "application/pdf")}
    data = {
        "name": f"{first_name} {last_name}".strip(),
        "email": email,
        "phone": phone,
        "org": company,
        "urls[LinkedIn]": linkedin_url,
        "urls[GitHub]": github_url,
        "comments": cover_letter,
        "eeoGender": "",
        "eeoRace": "",
        "eeoVeteran": "",
        "eeoDisability": "",
    }

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://jobs.lever.co",
        "Referer": apply_url,
    }

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.post(endpoint, data=data, files=files, headers=headers)
        if resp.status_code in (200, 201, 302):
            return {"success": True, "ats": "lever"}
        return {
            "success": False,
            "error": f"Lever returned {resp.status_code}: {resp.text[:300]}",
        }


async def submit_workable(
    apply_url: str,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    cv_base64: str,
    cv_filename: str,
    cover_letter: str,
    linkedin_url: str = "",
) -> dict:
    """Submit application to Workable via public API."""
    match = re.search(r"workable\.com/(?:[^/]+/)?j/([A-Z0-9]+)", apply_url, re.IGNORECASE)
    if not match:
        return {"success": False, "error": "Cannot parse Workable URL"}

    shortcode = match.group(1)
    url = f"https://apply.workable.com/api/v1/jobs/{shortcode}/apply"

    payload = {
        "firstname": first_name,
        "lastname": last_name,
        "email": email,
        "phone": phone,
        "resume": {"name": cv_filename, "data": cv_base64},
        "cover_letter": cover_letter,
        "social_profiles": [{"type": "linkedin", "url": linkedin_url}] if linkedin_url else [],
        "answers": [],
    }

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://apply.workable.com",
        "Referer": apply_url,
    }

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code in (200, 201):
            return {"success": True, "ats": "workable"}
        return {
            "success": False,
            "error": f"Workable returned {resp.status_code}: {resp.text[:300]}",
        }


async def submit_via_ats(apply_url: str, ats_platform: str, user_data: dict) -> dict:
    """Route application to the correct ATS submission function."""
    if ats_platform == "greenhouse":
        return await submit_greenhouse(
            apply_url=apply_url,
            first_name=user_data["first_name"],
            last_name=user_data["last_name"],
            email=user_data["email"],
            phone=user_data.get("phone", ""),
            cv_base64=user_data["cv_base64"],
            cv_filename=user_data["cv_filename"],
            cover_letter=user_data["cover_letter"],
            linkedin_url=user_data.get("linkedin_url", ""),
        )
    if ats_platform == "lever":
        cv_bytes = base64.b64decode(user_data["cv_base64"])
        return await submit_lever(
            apply_url=apply_url,
            first_name=user_data["first_name"],
            last_name=user_data["last_name"],
            email=user_data["email"],
            phone=user_data.get("phone", ""),
            cv_bytes=cv_bytes,
            cv_filename=user_data["cv_filename"],
            cover_letter=user_data["cover_letter"],
            linkedin_url=user_data.get("linkedin_url", ""),
        )
    if ats_platform == "workable":
        return await submit_workable(
            apply_url=apply_url,
            first_name=user_data["first_name"],
            last_name=user_data["last_name"],
            email=user_data["email"],
            phone=user_data.get("phone", ""),
            cv_base64=user_data["cv_base64"],
            cv_filename=user_data["cv_filename"],
            cover_letter=user_data["cover_letter"],
            linkedin_url=user_data.get("linkedin_url", ""),
        )
    return {"success": False, "error": f"ATS platform '{ats_platform}' not supported"}
