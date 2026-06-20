import asyncio
import os
import uuid
from datetime import datetime, timezone

import httpx

RAPIDAPI_KEY = os.environ.get('RAPIDAPI_KEY', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

_raw_supabase_url = os.environ.get('SUPABASE_URL', '')
if _raw_supabase_url and not _raw_supabase_url.startswith('https://'):
    # Seen when SUPABASE_URL secret holds the postgresql:// DB connection string
    # instead of the project URL (https://<ref>.supabase.co).
    raise ValueError(
        f'SUPABASE_URL must start with https:// — got {_raw_supabase_url.split("://")[0]}://...\n'
        'Set the SUPABASE_URL secret to your Supabase project URL, e.g.\n'
        '  https://abcdefghijkl.supabase.co\n'
        'NOT the database connection string.'
    )
SUPABASE_URL = _raw_supabase_url

RAPIDAPI_HEADERS = {
    'X-RapidAPI-Key': RAPIDAPI_KEY,
    'X-RapidAPI-Host': 'active-jobs-db.p.rapidapi.com'
}

ATS_MAP = {
    'greenhouse': 'greenhouse',
    'lever': 'lever',
    'comeet': 'comeet',
    'ashby': 'ashby',
    'bamboohr': 'bamboohr',
    'workable': 'workable',
    'smartrecruiters': 'smartrecruiters',
}


async def fetch_active_jobs(limit=100, offset=0) -> list:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            'https://active-jobs-db.p.rapidapi.com/active-ats',
            headers=RAPIDAPI_HEADERS,
            params={
                'time_frame': '24h',
                'limit': limit,
                'offset': offset,
                'description_format': 'text',
                'location': '"Israel"',
            }
        )
        if resp.status_code != 200:
            print(f'[active-jobs] API error {resp.status_code}: {resp.text[:200]}')
            return []
        data = resp.json()
        jobs = data if isinstance(data, list) else data.get('data', [])
        print(f'[active-jobs] Fetched {len(jobs)} jobs')
        return jobs


async def save_jobs_to_supabase(jobs: list) -> dict:
    if not jobs:
        return {'saved': 0, 'skipped': 0}

    saved = skipped = 0
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
    }

    async with httpx.AsyncClient(timeout=30) as client:
        for job in jobs:
            try:
                resp = await client.post(
                    f'{SUPABASE_URL}/rest/v1/Job?on_conflict=url',
                    headers=headers,
                    json=job,
                )
                if resp.status_code in (200, 201):
                    saved += 1
                else:
                    print(f'[active-jobs] Save error {resp.status_code}: {resp.text[:100]}')
                    skipped += 1
            except Exception as e:
                print(f'[active-jobs] Error: {e}')
                skipped += 1

    return {'saved': saved, 'skipped': skipped}


async def fetch_and_save_jobs():
    raw_jobs = await fetch_active_jobs(limit=100)
    now = datetime.now(timezone.utc).isoformat()

    records = []
    skipped = 0

    for raw in raw_jobs:
        url = raw.get('url', '')
        if not url:
            skipped += 1
            continue

        source = raw.get('source', '').lower()
        ats_platform = None
        apply_type = 'external'
        for key, platform in ATS_MAP.items():
            if key in source or key in url.lower():
                ats_platform = platform
                apply_type = 'auto'
                break

        records.append({
            'id': str(uuid.uuid4()),
            'url': url,
            'apply_url': url,
            'title': raw.get('title', ''),
            'company': raw.get('organization', ''),
            'location': (raw.get('locations_derived') or [''])[0],
            'description': raw.get('description_text', ''),
            'source': 'active_jobs_db',
            'ats_platform': ats_platform,
            'apply_type': apply_type,
            'is_active': True,
            'created_at': now,
            'updated_at': now,
        })

    result = await save_jobs_to_supabase(records)
    result['skipped'] = result.get('skipped', 0) + skipped
    print(f'[active-jobs] Done: {result["saved"]} saved, {result["skipped"]} skipped')
    return result


if __name__ == '__main__':
    asyncio.run(fetch_and_save_jobs())
