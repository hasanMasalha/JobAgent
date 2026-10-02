import { displayApplyType, isLinkedInListing } from "@/lib/detect-apply-type";

// A LinkedIn listing applies through the extension whatever its stored
// apply_type: nothing has ever recorded whether a listing is Easy Apply, so
// every LinkedIn row is "external" or "auto". Job cards and the Matches tabs
// go by the URL instead.

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

describe("displayApplyType", () => {
  const linkedin = "https://www.linkedin.com/jobs/view/1";

  it.each(["external", "auto", "extension", null, undefined])("shows a LinkedIn listing stored as %s as extension", (apply_type) => {
    expect(displayApplyType({ url: linkedin, apply_type })).toBe("extension");
  });

  it("keeps the stored type for everything else", () => {
    expect(displayApplyType({ url: "https://acme.example/careers/1", apply_type: "external" })).toBe("external");
    expect(displayApplyType({ url: "https://boards.greenhouse.io/acme/jobs/1", apply_type: "auto" })).toBe("auto");
    expect(displayApplyType({ url: "https://acme.example/careers/1" })).toBe("external");
  });
});
