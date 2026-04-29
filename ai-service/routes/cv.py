import json

import anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from embedder import embed

router = APIRouter()
_client = anthropic.Anthropic()


class ProcessCVRequest(BaseModel):
    raw_text: str
    user_id: str


@router.post("/process-cv")
async def process_cv(req: ProcessCVRequest):
    # Extract structured data from CV using Claude Haiku
    message = _client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": (
                    "Extract from this CV. Return only valid JSON, no markdown:\n"
                    '{"skills": ["string"], "job_titles": ["string"], '
                    '"years_experience": 0, '
                    '"seniority_level": "junior|mid|senior", '
                    '"clean_summary": "string"}\n\n'
                    "years_experience: count only professional work experience, not education. "
                    "Internships count as 0.5 years. Bootcamps do NOT count as experience.\n"
                    "seniority_level: junior = 0-2 yrs, mid = 3-5 yrs, senior = 6+ yrs.\n\n"
                    + req.raw_text
                ),
            }
        ],
    )

    raw = message.content[0].text.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        raw = raw.rsplit("```", 1)[0].strip()

    try:
        extracted = json.loads(raw)
    except json.JSONDecodeError as err:
        raise HTTPException(status_code=500, detail=f"Invalid JSON from Claude: {raw}") from err

    skills_json = {
        "skills": extracted.get("skills", []),
        "job_titles": extracted.get("job_titles", []),
        "years_experience": extracted.get("years_experience", 0),
        "seniority_level": extracted.get("seniority_level", "junior"),
    }
    clean_summary = extracted.get("clean_summary", "")

    embed_text = clean_summary + " " + " ".join(skills_json["skills"])
    embedding = embed(embed_text)

    return {
        "skills_json": skills_json,
        "clean_summary": clean_summary,
        "embedding": embedding,
    }
