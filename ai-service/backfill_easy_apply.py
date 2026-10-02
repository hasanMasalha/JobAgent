"""One-off: mark existing LinkedIn jobs that offer Easy Apply.

New scrapes record this themselves (linkedin_fetcher.py). Rows scraped before
that are all 'external', because nothing looked. This fetches each active
LinkedIn job's public (logged-out) page, reads LinkedIn's on-site/off-site
apply marker (linkedin_easy_apply.detect_easy_apply) and sets
apply_type = 'extension' where the job is on-site.

Only rows that are currently 'external' are touched: 'auto' (ATS or a recruiter
email) deliberately wins over Easy Apply. Off-site and unknown rows are left
as they are. No LinkedIn login is used.

    python backfill_easy_apply.py --dry-run          # report only, no writes
    python backfill_easy_apply.py --limit 50         # first 50 jobs
    python backfill_easy_apply.py                    # every active LinkedIn job

Paced at one request every ~2.5s (about an hour per 1,400 jobs). It stops if
LinkedIn starts refusing (429 / 999) rather than push on; run it again later —
jobs already marked 'extension' are skipped.
"""
import argparse
import asyncio
import os
import random

import asyncpg
import httpx

from linkedin_easy_apply import detect_easy_apply, linkedin_job_id

GUEST_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
# Give up after this many refusals in a row: LinkedIn is rate limiting us.
MAX_CONSECUTIVE_REFUSALS = 5


async def main(limit: int | None, dry_run: bool) -> None:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        rows = await conn.fetch(
            """
            SELECT id, url FROM "Job"
            WHERE is_active = true
              AND apply_type = 'external'
              AND url ILIKE '%linkedin.com/jobs/view/%'
            ORDER BY scraped_at DESC
            """
            + (f" LIMIT {int(limit)}" if limit else "")
        )
        print(f"[backfill] {len(rows)} active external LinkedIn jobs to check" + (" (dry run)" if dry_run else ""))

        counts = {"easy_apply": 0, "offsite": 0, "unknown": 0, "gone": 0, "error": 0}
        refusals = 0

        async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=20, follow_redirects=True) as client:
            for i, row in enumerate(rows, 1):
                job_id = linkedin_job_id(row["url"])
                if not job_id:
                    counts["unknown"] += 1
                    continue

                try:
                    res = await client.get(GUEST_URL.format(job_id=job_id))
                except Exception as e:
                    print(f"[backfill] {job_id}: request failed: {e}")
                    counts["error"] += 1
                    await asyncio.sleep(5)
                    continue

                if res.status_code in (429, 999):
                    refusals += 1
                    counts["error"] += 1
                    print(f"[backfill] {job_id}: LinkedIn refused ({res.status_code}), backing off")
                    if refusals >= MAX_CONSECUTIVE_REFUSALS:
                        print("[backfill] LinkedIn is rate limiting — stopping. Run again later.")
                        break
                    await asyncio.sleep(60)
                    continue
                refusals = 0

                if res.status_code == 404:
                    counts["gone"] += 1
                elif res.status_code != 200:
                    counts["error"] += 1
                else:
                    easy = detect_easy_apply(res.text)
                    if easy is True:
                        counts["easy_apply"] += 1
                        if not dry_run:
                            # Re-check the type in the UPDATE: a scrape may have
                            # changed the row since it was selected.
                            await conn.execute(
                                """UPDATE "Job" SET apply_type = 'extension' WHERE id = $1 AND apply_type = 'external'""",
                                row["id"],
                            )
                    elif easy is False:
                        counts["offsite"] += 1
                    else:
                        counts["unknown"] += 1

                if i % 50 == 0:
                    print(f"[backfill] {i}/{len(rows)} {counts}")
                await asyncio.sleep(random.uniform(2.0, 3.0))

        print(f"[backfill] done: {counts}" + (" — dry run, nothing written" if dry_run else ""))
    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mark existing LinkedIn jobs that offer Easy Apply.")
    parser.add_argument("--limit", type=int, default=None, help="check at most this many jobs")
    parser.add_argument("--dry-run", action="store_true", help="report what would change without writing")
    args = parser.parse_args()
    asyncio.run(main(args.limit, args.dry_run))
