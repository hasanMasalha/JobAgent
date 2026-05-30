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

  // Auto apply — known ATS
  if (AUTO_ATS.some((ats) => url.includes(ats))) {
    return "auto";
  }

  // Auto apply — recruiter email in description
  if (EMAIL_RE.test(desc)) {
    return "auto";
  }

  // Extension — LinkedIn job that is (or might be) Easy Apply.
  // has_easy_apply === false means the scraper explicitly told us it's NOT
  // Easy Apply. undefined means we don't know, so we assume it could be.
  if (url.includes("linkedin.com") && url.includes("/jobs/view/")) {
    if (job.has_easy_apply === false) {
      return "external";
    }
    return "extension";
  }

  return "external";
}

export function extractRecruiterEmail(description: string): string | null {
  const match = description?.match(EMAIL_RE);
  return match ? match[0] : null;
}
