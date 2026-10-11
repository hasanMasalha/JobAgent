export type ApplyType = "external" | "extension" | "auto";

const AUTO_ATS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "smartrecruiters.com",
  "bamboohr.com",
  "workable.com",
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function detectApplyType(job: {
  url: string;
  source?: string;
  // JobSpy / scraper explicit signal. When undefined (old data / on-the-fly
  // detection) we assume true so LinkedIn jobs keep showing as extension.
  has_easy_apply?: boolean;
  description?: string;
}): ApplyType {
  const url = (job.url ?? "").toLowerCase();
  const desc = (job.description ?? "").toLowerCase();

  // Auto apply — known ATS. gh_jid means Greenhouse is embedded on the
  // company's own domain, so the greenhouse.io hostname check above misses it.
  if (AUTO_ATS.some((ats) => url.includes(ats)) || url.includes("gh_jid=")) {
    return "auto";
  }

  // Auto apply — recruiter email in description
  if (EMAIL_RE.test(desc)) {
    return "auto";
  }

  // Extension — LinkedIn job only when the scraper explicitly confirmed Easy Apply.
  // Unknown (undefined/null) defaults to external, not extension.
  if (url.includes("linkedin.com") && url.includes("/jobs/view/")) {
    if (job.has_easy_apply === true) return "extension";
    return "external";
  }

  return "external";
}

// ATS hosts JobAgent submits to directly from a job card.
export const DIRECT_APPLY_ATS_DOMAINS = [
  "greenhouse.io", "lever.co", "workable.com",
  "ashbyhq.com", "comeet.com", "bamboohr.com",
];

/**
 * A job whose listing is on LinkedIn with no ATS to submit to. Whether it can
 * be applied to through the extension is a separate, stored fact:
 * `apply_type === "extension"` means the scraper saw LinkedIn's on-site apply
 * (Easy Apply) marker on the public job page (ai-service/linkedin_fetcher.py,
 * detect_easy_apply). A LinkedIn listing without it is treated as external.
 */
export function isLinkedInListing(url: string | null | undefined): boolean {
  const u = (url ?? "").toLowerCase();
  return u.includes("linkedin.com") && !DIRECT_APPLY_ATS_DOMAINS.some((d) => u.includes(d));
}

export type AtsPlatform = "greenhouse" | "lever" | "workable" | "comeet" | "ashby" | "bamboohr";

/** The ATS `/api/apply/quick` submits to for this URL, if any. */
export function detectATS(url: string | null | undefined): AtsPlatform | null {
  const u = (url ?? "").toLowerCase();
  // gh_jid means Greenhouse is embedded on the company's own domain instead
  // of greenhouse.io directly.
  if (u.includes("greenhouse.io") || u.includes("gh_jid=")) return "greenhouse";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("workable.com")) return "workable";
  if (u.includes("comeet.com")) return "comeet";
  if (u.includes("ashbyhq.com")) return "ashby";
  if (u.includes("bamboohr.com")) return "bamboohr";
  return null;
}

type ApplyJob = { url: string | null | undefined; apply_url?: string | null; apply_type?: string | null };

/**
 * The URL quick apply submits to: `apply_url` is the confirmed ATS link
 * (Arbeitnow's redirect, the ATS behind a LinkedIn listing); `url` is the
 * listing, used only when there is none.
 */
export function applySubmitUrl(job: ApplyJob): string {
  return job.apply_url || job.url || "";
}

/**
 * A LinkedIn listing with no ATS `apply_url`: quick apply sends it to the
 * extension (`needs_extension`) whatever its stored type.
 */
export function needsExtension(job: ApplyJob): boolean {
  return !job.apply_url && (job.url ?? "").toLowerCase().includes("linkedin.com");
}

/**
 * What Apply does for a job — the single decision behind a card's badge and
 * whether its Apply button is enabled, taken in the same order as
 * `/api/apply/quick`:
 * - `ats`: quick apply submits to the ATS (`detectATS(applySubmitUrl(job))`).
 * - `extension`: a confirmed LinkedIn Easy Apply job; Apply opens the review
 *   screen and Confirm there hands it to the extension.
 * - `email`: stored `auto` with no ATS — the scraper found an email address in
 *   the description. JobAgent doesn't apply by email (the batch email path
 *   was removed 2026-10-11: those addresses are mostly accommodation, EEO and
 *   fraud-report inboxes), so the badge only says to apply by email; Apply
 *   stays disabled.
 * - `external`: apply on the company's site.
 * - `review`: an ATS we don't submit to server-side (Ashby, whose invisible
 *   reCAPTCHA refuses our server's browser). Apply opens fill-and-review
 *   (`/dashboard/apply/[jobId]?mode=download`): the form's questions with
 *   the user's answers, the tailored CV and letter; the user submits.
 * Apply is enabled for `ats`, `extension` and `review`.
 */
export type ApplyRoute = "ats" | "extension" | "review" | "email" | "external";

/**
 * ATSs JobAgent fills and submits from its own server. Ashby isn't one:
 * every Ashby form runs invisible reCAPTCHA v3, and no Ashby application from
 * the server has ever gone through (2026-10-11).
 */
export function serverSubmits(platform: AtsPlatform | null): boolean {
  return platform !== null && platform !== "ashby";
}

export function applyRoute(job: ApplyJob): ApplyRoute {
  if (needsExtension(job)) {
    // Quick apply would hand any of these to the extension, but only a
    // confirmed Easy Apply job has anything there to automate.
    if (job.apply_type === "extension") return "extension";
    return job.apply_type === "auto" ? "email" : "external";
  }
  if (job.apply_type === "external") return "external";
  const ats = detectATS(applySubmitUrl(job));
  if (ats) return serverSubmits(ats) ? "ats" : "review";
  return job.apply_type === "auto" ? "email" : "external";
}

/**
 * The Matches apply-route tab a job falls under — from applyRoute(), so a tab
 * shows exactly the jobs whose cards carry that badge. Email-only jobs can't
 * be applied to from JobAgent, so they sit with External.
 */
export type ApplyTab = "direct" | "extension" | "external";

export function applyTab(job: ApplyJob): ApplyTab {
  const route = applyRoute(job);
  if (route === "ats") return "direct";
  if (route === "extension") return "extension";
  // review: the user submits on the company's form, with JobAgent's answers.
  return "external";
}

export function canApplyFromCard(job: ApplyJob): boolean {
  const route = applyRoute(job);
  return route === "ats" || route === "extension" || route === "review";
}

/**
 * A confirmed LinkedIn Easy Apply job: Apply opens the review screen
 * (`/dashboard/apply/[jobId]`) and Confirm there hands it to the extension.
 * Every job list (Matches' JobCard, Saved) decides with this, so they show
 * the same badge and Apply for the same job.
 */
export function isEasyApplyJob(job: ApplyJob): boolean {
  return applyRoute(job) === "extension";
}
