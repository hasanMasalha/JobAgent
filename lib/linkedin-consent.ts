// The LinkedIn automation risk notice, shown at the point of decision — before
// the extension is installed or handed an application — not only in Terms.
// Consent is a timestamp on the user row (User.linkedin_automation_consent_at),
// recorded by POST /api/linkedin/automation-consent.

/** The notice and, once consented, the extension setup. */
export const LINKEDIN_SETUP_PATH = "/dashboard/linkedin-extension";

/**
 * Link to the notice that comes back to `next` once consent is given. Only a
 * path inside the dashboard is passed through, so the page can't be used to
 * send someone elsewhere.
 */
export function linkedInSetupHref(next?: string): string {
  return next && isSafeNext(next) ? `${LINKEDIN_SETUP_PATH}?next=${encodeURIComponent(next)}` : LINKEDIN_SETUP_PATH;
}

export function isSafeNext(next: string | null | undefined): next is string {
  return !!next && next.startsWith("/dashboard/") && !next.startsWith("//") && !next.includes("\\");
}

/** Returned with 403 by routes that hand an application to the extension. */
export const LINKEDIN_CONSENT_REQUIRED_RESPONSE = {
  error: "linkedin_consent_required",
  message: "Read and accept the LinkedIn automation notice before using the extension.",
} as const;
