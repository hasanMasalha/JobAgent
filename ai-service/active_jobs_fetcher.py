import os

import asyncpg
import httpx

RAPIDAPI_KEY = os.environ.get('RAPIDAPI_KEY', '')
HEADERS = {
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
            'https://active-jobs-db.p.rapidapi.com/active-ats-7d',
            headers=HEADERS,
            params={'limit': limit, 'offset': offset}
        )
        if resp.status_code != 200:
            print(f'[active-jobs] Error: {resp.status_code}')
            return []
        data = resp.json()
        jobs = data if isinstance(data, list) else data.get('data', [])
        print(f'[active-jobs] Fetched {len(jobs)} jobs')
        return jobs


async def fetch_and_save_jobs():
    DATABASE_URL = os.environ.get('DATABASE_URL')
    conn = await asyncpg.connect(DATABASE_URL)
    saved = skipped = 0

    try:
        raw_jobs = await fetch_active_jobs(limit=100)

        for raw in raw_jobs:
            try:
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

                title = raw.get('title', '')
                company = raw.get('organization', '')
                locations = raw.get('locations_derived', [])
                location = locations[0] if locations else ''
                description = raw.get('description_text', '')

                salary_min = raw.get('ai_salary_min_value')
                salary_max = raw.get('ai_salary_max_value')
                salary = None  # noqa: F841
                if salary_min and salary_max:
                    currency = raw.get('ai_salary_currency', 'USD')
                    salary = f"{currency} {salary_min:,} - {salary_max:,}"  # noqa: F841

                await conn.execute("""
                    INSERT INTO "Job" (
                        id, url, apply_url, title, company,
                        location, description, source,
                        ats_platform, apply_type, is_active,
                        created_at, updated_at
                    ) VALUES (
                        gen_random_uuid(), $1, $2, $3, $4,
                        $5, $6, 'active_jobs_db', $7, $8,
                        true, NOW(), NOW()
                    )
                    ON CONFLICT (url) DO UPDATE SET
                        title = EXCLUDED.title,
                        description = EXCLUDED.description,
                        apply_url = EXCLUDED.apply_url,
                        ats_platform = EXCLUDED.ats_platform,
                        apply_type = EXCLUDED.apply_type,
                        is_active = true,
                        updated_at = NOW()
                """,
                    url, url, title, company,
                    location, description,
                    ats_platform, apply_type
                )
                saved += 1
            except Exception as e:
                print(f'[active-jobs] Error: {e}')
                skipped += 1

        print(f'[active-jobs] Done: {saved} saved, {skipped} skipped')
        return {'saved': saved, 'skipped': skipped}
    finally:
        await conn.close()
