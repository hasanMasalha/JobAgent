import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// One hand-over to the extension per job at a time. Every route that marks an
// application pending_extension (the Greenhouse start, the LinkedIn confirm,
// the LinkedIn batch) checks here first, under a lock per user + job:
//   - a job already submitted isn't handed over again;
//   - a job whose application is with the extension right now isn't either.
// Until 2026-10-12 nothing stopped it: reopening a LinkedIn job's apply page
// while it was pending created a second draft (/api/apply/prepare looks only
// for drafts), and Confirm charged and queued that one too — two charged
// pending_extension rows for one job. The Greenhouse start re-handed a
// running application, which the extension refused as busy, and the site
// then marked the running one manual and refunded it.
//
// `applied_at` is set when an application is handed over, so it says when it
// went to the extension. The AI service releases one that's still pending
// after PENDING_EXTENSION_TIMEOUT_HOURS (manual, credit refunded —
// ai-service/pending_release.py); after that it may be handed over again.

/** Keep in step with ai-service/pending_release.py. */
export const PENDING_EXTENSION_TIMEOUT_HOURS = 3;

const SUBMITTED = ["applied", "interviewing", "offer", "rejected"];

export type Tx = Prisma.TransactionClient;

/** Runs `fn` in a transaction holding a lock for this user + job, so two
 *  requests for the same job (a double click, two tabs) take turns. Prisma's
 *  default 2s to start a transaction was sometimes too short for a fresh
 *  connection to Supabase (seen locally, 2026-10-12). */
export async function withJobLock<T>(userId: string, jobId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext(${jobId}))`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

/** This user's application for the job that is submitted, or with the
 *  extension now (pending_extension, handed over within the timeout). */
export async function blockingApplication(
  tx: Tx,
  userId: string,
  jobId: string,
): Promise<{ id: string; status: string } | null> {
  const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT id, status FROM "Application"
    WHERE user_id = ${userId} AND job_id = ${jobId}
      AND (status = ANY(${SUBMITTED})
           OR (status = 'pending_extension'
               AND applied_at > NOW() - make_interval(hours => ${PENDING_EXTENSION_TIMEOUT_HOURS})))
    ORDER BY applied_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** The 409 body for a job that can't be handed over now. */
export function blockedResponse(status: string) {
  return status === "pending_extension"
    ? {
        error: "in_progress",
        message: "JobAgent is already applying to this job. Check your Applications page for the result.",
      }
    : { error: "already_applied", message: "You've already applied to this job." };
}
