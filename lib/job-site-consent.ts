// The job-site automation notice: before the extension fills in and submits
// an application on an employer's job site (Greenhouse first) — and receives
// the user's CV to attach — the user reads what it does and ticks a box.
// Separate from the LinkedIn notice (lib/linkedin-consent.ts). Recorded as
// User.job_site_automation_consent_at by POST /api/apply/job-site-consent.

import { isSafeNext } from "@/lib/linkedin-consent";

/** The notice, plus installing or updating the extension. */
export const JOB_SITE_SETUP_PATH = "/dashboard/job-site-extension";

/** The notice, coming back to `next`; `jobId` offers fill-and-review instead. */
export function jobSiteSetupHref(next?: string, jobId?: string): string {
  const q = new URLSearchParams();
  if (next && isSafeNext(next)) q.set("next", next);
  if (jobId) q.set("job", jobId);
  const qs = q.toString();
  return qs ? `${JOB_SITE_SETUP_PATH}?${qs}` : JOB_SITE_SETUP_PATH;
}

/** Returned with 403 by routes that hand a job-site application to the extension. */
export const JOB_SITE_CONSENT_REQUIRED_RESPONSE = {
  error: "job_site_consent_required",
  message: "Read and accept the job-site automation notice before the extension applies for you.",
} as const;

/**
 * Greenhouse applications go through the extension (1.6.0+) instead of the
 * server. Off until 1.6.0 is live on the Chrome Web Store: with it on, a user
 * without 1.6.0 is asked to install or update, so turning it on early would
 * leave nobody able to apply to Greenhouse.
 */
export function greenhouseViaExtension(): boolean {
  return process.env.NEXT_PUBLIC_GREENHOUSE_VIA_EXTENSION === "true";
}
