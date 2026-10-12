"""Releases applications left with the extension (pending_extension) too long.

Every hand-over to the extension charges an auto-apply, and the extension
reports how it ended, which refunds a manual / failed one. A report can be
lost (the tab or browser closed mid-way, the site unreachable at that
moment), and then the application stayed pending_extension and kept its
credit for good: on 2026-10-12 eleven had, the oldest a week old. And while
one is pending the site won't hand that job over again
(lib/extension-handover.ts).

So one still pending PENDING_EXTENSION_TIMEOUT_HOURS after it was handed over
(applied_at is set then) is marked manual with a reason, and its credit comes
back (refund_auto_apply: at most once). It may have gone in — the extension
just never said — so the reason says so. If the extension's report does
arrive later, update-status still takes "applied" over manual.
"""

from __future__ import annotations

# Keep in step with lib/extension-handover.ts. Long enough for a LinkedIn
# batch (12 an hour) and Greenhouse's 30-minute security-code wait.
PENDING_EXTENSION_TIMEOUT_HOURS = 3

TIMED_OUT_MESSAGE = (
    f"extension: timed_out — no result from the extension within {PENDING_EXTENSION_TIMEOUT_HOURS} hours, "
    "so the auto-apply was returned. It may have gone in: check the employer's site or your email."
)


async def refund_auto_apply(conn, application_id: str) -> bool:
    """Gives back the auto-apply an application holds, at most once: the flag
    is cleared in the same UPDATE (lib/usage.ts refundAutoApplyForApplication).
    An application that was never charged is never refunded."""
    charged = await conn.fetchrow(
        'UPDATE "Application" SET auto_apply_charged = false '
        "WHERE id = $1 AND auto_apply_charged = true RETURNING user_id",
        application_id,
    )
    if not charged:
        return False
    await conn.execute(
        'UPDATE "UserUsage" SET "autoAppliesThisMonth" = "autoAppliesThisMonth" - 1, '
        '"totalAutoApplies" = "totalAutoApplies" - 1 '
        'WHERE "userId" = $1 AND "autoAppliesThisMonth" > 0',
        charged["user_id"],
    )
    return True


async def release_stale_pending(conn) -> list[str]:
    """Marks every application pending_extension for longer than the timeout
    manual, refunding its credit. Returns their ids."""
    async with conn.transaction():
        rows = await conn.fetch(
            'UPDATE "Application" SET status = \'manual\', error_message = $1 '
            "WHERE status = 'pending_extension' "
            "AND applied_at < NOW() - make_interval(hours => $2) "
            "RETURNING id",
            TIMED_OUT_MESSAGE,
            PENDING_EXTENSION_TIMEOUT_HOURS,
        )
        ids = [r["id"] for r in rows]
        for application_id in ids:
            await refund_auto_apply(conn, application_id)
    return ids
