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
 * A job whose listing is on LinkedIn with no ATS to submit to. These apply
 * through the extension whatever `apply_type` says: nothing has ever told us
 * at scrape time whether a listing offers Easy Apply (JobSpy doesn't return
 * it), so stored LinkedIn rows are all "external" or "auto". The extension
 * finds out on the page, and reports `manual` when there is no Easy Apply.
 */
export function isLinkedInListing(url: string | null | undefined): boolean {
  const u = (url ?? "").toLowerCase();
  return u.includes("linkedin.com") && !DIRECT_APPLY_ATS_DOMAINS.some((d) => u.includes(d));
}

/** The apply route a job card offers — what its badge and the Matches tabs show. */
export function displayApplyType(job: { url?: string | null; apply_type?: string | null }): string {
  return isLinkedInListing(job.url) ? "extension" : job.apply_type ?? "external";
}

export function extractRecruiterEmail(description: string): string | null {
  const match = description?.match(EMAIL_RE);
  return match ? match[0] : null;
}
