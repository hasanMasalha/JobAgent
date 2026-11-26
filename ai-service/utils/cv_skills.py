"""CV.skills_json as the dict every reader expects.

/process-cv stores {"skills": [...], "years_experience": n, "job_titles": [...],
"seniority_level": ...}. Older rows aren't all like that: a CV generated on
2026-09-27 holds a bare list of skill names, and `.get` on it raised
AttributeError, so the daily match skipped that user every run (found
2026-11-26) and apply would have failed the same way. Readers go through
this instead of trusting the column's shape.
"""
import json
from typing import Any


def cv_skills_json(raw: Any) -> dict:
    """The stored value as a dict: a JSON string is parsed, a list of skill
    names becomes {"skills": [...]}, anything else unreadable becomes {}."""
    if isinstance(raw, (str, bytes)):
        try:
            raw = json.loads(raw)
        except ValueError:
            return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, list):
        return {"skills": [s for s in raw if isinstance(s, str) and s.strip()]}
    return {}
