import { isEasyApplyJob, isLinkedInListing } from "@/lib/detect-apply-type";

// A LinkedIn listing with no ATS to submit to. Whether the extension can apply
// to it is a separate, stored fact: apply_type "extension" is written only when
// the scraper saw LinkedIn's Easy Apply marker (ai-service/linkedin_easy_apply.py).

describe("isLinkedInListing", () => {
  it.each([
    "https://www.linkedin.com/jobs/view/4012345678",
    "https://il.linkedin.com/jobs/view/senior-engineer-at-acme-4012345678",
    "HTTPS://WWW.LINKEDIN.COM/jobs/view/1",
  ])("is true for %s", (url) => {
    expect(isLinkedInListing(url)).toBe(true);
  });

  it.each([
    ["an ATS URL", "https://boards.greenhouse.io/acme/jobs/1"],
    ["a company careers page", "https://acme.example/careers/1"],
    ["a URL naming both LinkedIn and an ATS", "https://jobs.lever.co/acme/1?source=linkedin.com"],
    ["no URL", null],
  ])("is false for %s", (_what, url) => {
    expect(isLinkedInListing(url)).toBe(false);
  });
});

// Matches (JobCard) and Saved both decide the Extension route with this.
describe("isEasyApplyJob", () => {
  const li = "https://www.linkedin.com/jobs/view/4456907190/";

  it("is true for a LinkedIn listing stored as extension", () => {
    expect(isEasyApplyJob({ url: li, apply_type: "extension" })).toBe(true);
  });

  it.each([
    ["a LinkedIn listing not confirmed as Easy Apply", li, "external"],
    ["a LinkedIn listing with no stored type", li, null],
    ["a LinkedIn listing that resolved to an ATS", "https://boards.greenhouse.io/acme/jobs/1?src=linkedin.com", "extension"],
    ["a non-LinkedIn job", "https://jobs.lever.co/acme/1", "extension"],
    ["no URL", null, "extension"],
  ])("is false for %s", (_what, url, applyType) => {
    expect(isEasyApplyJob({ url, apply_type: applyType })).toBe(false);
  });
});
