import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A job card's badge and Apply button come from applyRoute(), which must take
// the same decision as /api/apply/quick. They drifted once: the card looked
// only at `url` while quick apply submits to `apply_url ?? url` and knows
// embedded Greenhouse (gh_jid), so ~3,000 Arbeitnow and company-site
// Greenhouse/Lever/Ashby jobs showed a disabled Apply quick apply could submit.

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "u1@example.com" } } }) },
  }),
}));

jest.mock("@/lib/db", () => ({
  db: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
  },
}));

jest.mock("@/lib/usage", () => ({
  ...jest.requireActual("@/lib/usage"),
  checkAndIncrementAutoApply: jest.fn(),
  refundAutoApply: jest.fn(),
  refundAutoApplyForApplication: jest.fn(),
}));

import { db } from "@/lib/db";
import * as usage from "@/lib/usage";
import { POST as quickApply } from "@/app/api/apply/quick/route";
import JobCard from "@/app/dashboard/JobCard";
import { applyRoute, applyTab, canApplyFromCard, needsExtension, type ApplyRoute, type ApplyTab } from "@/lib/detect-apply-type";

const mdb = db as unknown as {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  user: { findUnique: jest.Mock; findFirst: jest.Mock };
};

type Row = { url: string; apply_url: string | null; apply_type: string };

const LI = "https://www.linkedin.com/jobs/view/4012345678";
const JOBS: [string, Row, ApplyRoute][] = [
  ["Greenhouse listing", { url: "https://job-boards.greenhouse.io/acme/jobs/1", apply_url: null, apply_type: "auto" }, "ats"],
  ["Lever listing", { url: "https://jobs.lever.co/acme/1", apply_url: null, apply_type: "auto" }, "ats"],
  ["Comeet listing", { url: "https://www.comeet.com/jobs/acme/1", apply_url: null, apply_type: "auto" }, "ats"],
  ["BambooHR listing", { url: "https://acme.bamboohr.com/careers/1", apply_url: null, apply_type: "auto" }, "ats"],
  ["Arbeitnow job whose apply_url is Ashby", { url: "https://www.arbeitnow.com/jobs/acme/1", apply_url: "https://jobs.ashbyhq.com/acme/1", apply_type: "auto" }, "ats"],
  ["Arbeitnow job whose apply_url is Lever", { url: "https://www.arbeitnow.fr/jobs/acme/1", apply_url: "https://jobs.lever.co/acme/1", apply_type: "auto" }, "ats"],
  ["Greenhouse embedded on the company site", { url: "https://www.acme.example/careers?gh_jid=123", apply_url: null, apply_type: "auto" }, "ats"],
  ["LinkedIn listing resolved to Greenhouse", { url: LI, apply_url: "https://boards.greenhouse.io/acme/jobs/1", apply_type: "auto" }, "ats"],
  ["confirmed Easy Apply job", { url: LI, apply_url: null, apply_type: "extension" }, "extension"],
  ["LinkedIn listing not confirmed as Easy Apply", { url: LI, apply_url: null, apply_type: "external" }, "external"],
  ["LinkedIn listing with an email in the description", { url: LI, apply_url: null, apply_type: "auto" }, "email"],
  ["Indeed job with an email in the description", { url: "https://www.indeed.com/viewjob?jk=1", apply_url: null, apply_type: "auto" }, "email"],
  ["SmartRecruiters job (not an ATS quick apply submits to)", { url: "https://jobs.smartrecruiters.com/acme/1", apply_url: null, apply_type: "auto" }, "email"],
  ["company careers page", { url: "https://www.acme.example/careers/1", apply_url: null, apply_type: "external" }, "external"],
  ["stored external despite an ATS URL", { url: "https://www.comeet.com/jobs/acme/2", apply_url: null, apply_type: "external" }, "external"],
];

const post = () =>
  new NextRequest("http://localhost/api/apply/quick", { method: "POST", body: JSON.stringify({ jobId: "j1" }) });

beforeEach(() => {
  jest.clearAllMocks();
  mdb.user.findUnique.mockResolvedValue({ plan: "free" });
  mdb.user.findFirst.mockResolvedValue({ first_name: "A", last_name: "B", email: "u1@example.com", phone: null, linkedin_url: null });
  (usage.checkAndIncrementAutoApply as jest.Mock).mockResolvedValue({ allowed: true, remaining: 4 });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, status: "applying" }) });
});

async function runQuickApply(row: Row) {
  mdb.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes('FROM "Job"')) return Promise.resolve([{ ...row, title: "Engineer", company: "Acme" }]);
    if (sql.includes('INSERT INTO "Application"')) return Promise.resolve([{ id: "app-1" }]);
    return Promise.resolve([]);
  });
  const body = await (await quickApply(post())).json();
  const submitted = (global.fetch as jest.Mock).mock.calls.some(([url]) => String(url).endsWith("/ats-apply"));
  return { body, submitted };
}

function renderCard(row: Row, onSelect?: (id: string) => void): string {
  const job = { id: "j1", title: "Engineer", company: "Acme", description: "", location: null, salary_min: null, salary_max: null, scraped_at: new Date().toISOString(), ...row };
  return renderToStaticMarkup(createElement(JobCard, { job, onSelect }));
}

// The Matches tab a job is listed under, by its card's badge.
const TAB: Record<ApplyRoute, ApplyTab> = { ats: "direct", extension: "extension", email: "external", external: "external" };

const BADGE: Record<ApplyRoute, string> = {
  ats: "Direct Apply",
  extension: "Extension",
  email: "Email apply",
  external: "External",
};

describe.each(JOBS)("%s", (_what, row, expected) => {
  it(`is routed ${expected}`, () => {
    expect(applyRoute(row)).toBe(expected);
  });

  it("is submitted by quick apply exactly when the card says Direct Apply", async () => {
    const { body, submitted } = await runQuickApply(row);
    expect(submitted).toBe(applyRoute(row) === "ats");
    expect(Boolean(body.needs_extension)).toBe(needsExtension(row));
    if (applyRoute(row) === "extension") expect(body.needs_extension).toBe(true);
  });

  it("gets the badge and the Apply button from the same route", () => {
    const html = renderCard(row);
    expect(html).toContain(BADGE[applyRoute(row)]);
    for (const [route, label] of Object.entries(BADGE)) {
      if (route !== applyRoute(row)) expect(html).not.toContain(`>${label}<`);
    }
    const disabledApply = html.includes('title="Apply manually on their website"');
    expect(disabledApply).toBe(!canApplyFromCard(row));
  });

  // Batch apply is the extension's queue (batch-mark-pending). An ATS job used
  // to be selectable too, went to batch email auto-apply, was skipped, and the
  // page said "Sent 0 auto applications!" in green.
  it("is offered for batch apply only if it's an Easy Apply job", () => {
    const html = renderCard(row, () => {});
    expect(html.includes('type="checkbox"')).toBe(applyRoute(row) === "extension");
  });

  // Direct = every job whose card says Direct Apply, so filtering to it finds
  // all of them and only them.
  it("is listed under the Matches tab that matches its badge", () => {
    expect(applyTab(row)).toBe(TAB[applyRoute(row)]);
  });
});
