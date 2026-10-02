import { NextRequest } from "next/server";

// LinkedIn Easy Apply through the extension must never carry an answer the
// user didn't give:
//  - the extension's own answer logic returns nothing rather than a guess;
//  - the server sends no fallback values, and holds back the six answers
//    that used to be database defaults until the user has confirmed them;
//  - extensions older than the first safe version get no application at all.

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));

jest.mock("@/lib/db", () => ({
  db: {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    easyApplyAnswer: { findMany: jest.fn() },
  },
}));

jest.mock("@/lib/usage", () => ({
  ...jest.requireActual("@/lib/usage"),
  refundAutoApplyForApplication: jest.fn(),
}));

import { db } from "@/lib/db";
import * as usage from "@/lib/usage";
import { GET as checkPending } from "@/app/api/apply/check-pending/route";
import { EXTENSION_VERSION_HEADER, MIN_EXTENSION_VERSION, isVersionAtLeast } from "@/lib/extension-version";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const answers = require("../../chrome-extension/answers.js") as {
  jaAnswerForLabel: (label: string, application: Record<string, unknown>) => string | null;
  jaBooleanAnswer: (label: string, application: Record<string, unknown>) => boolean | null;
  jaSavedAnswer: (label: string, application: Record<string, unknown>) => string | null;
  jaMatchOption: (options: string[], answer: string | null) => number;
  jaYesNoOption: (options: string[], wantYes: boolean) => number;
  jaIsEasyApplyLabel: (text: string | null, ariaLabel: string | null) => boolean;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const manifests = ["manifest.json", "manifest.prod.json"].map((f) => require(`../../chrome-extension/${f}`)) as {
  version: string;
  content_scripts: { js: string[] }[];
}[];

const mdb = db as unknown as {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  user: { findUnique: jest.Mock };
  easyApplyAnswer: { findMany: jest.Mock };
};
const refund = usage.refundAutoApplyForApplication as jest.Mock;

const get = (version?: string) =>
  new NextRequest("http://localhost/api/apply/check-pending?jobId=4012345678", {
    headers: version ? { [EXTENSION_VERSION_HEADER]: version } : {},
  });

// What a row looks like for someone who never opened Profile: the six
// answers hold the old column defaults.
const UNTOUCHED = {
  email: "dana@example.com", application_details_confirmed_at: null,
  first_name: "Dana", last_name: "Levi", phone: null, city: null,
  linkedin_url: null, github_url: null, portfolio_url: null, expected_salary: null,
  notice_period: "30", years_of_experience: "2", highest_education: "Bachelor's Degree",
  work_authorized: true, requires_sponsorship: false, willing_to_relocate: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  mdb.$queryRaw.mockResolvedValue([{ id: "app-1", job_url: "https://www.linkedin.com/jobs/view/4012345678", skills_json: [] }]);
  mdb.$executeRaw.mockResolvedValue(1);
  mdb.easyApplyAnswer.findMany.mockResolvedValue([]);
  mdb.user.findUnique.mockResolvedValue(UNTOUCHED);
});

describe("extension version gate", () => {
  it("compares dotted versions numerically", () => {
    expect(isVersionAtLeast("1.5.0")).toBe(true);
    expect(isVersionAtLeast("1.10.0")).toBe(true);
    expect(isVersionAtLeast("2.0")).toBe(true);
    expect(isVersionAtLeast("1.4.9")).toBe(false);
    expect(isVersionAtLeast("1.4.0")).toBe(false);
    expect(isVersionAtLeast("0")).toBe(false);
    expect(isVersionAtLeast(null)).toBe(false);
    expect(isVersionAtLeast("latest")).toBe(false);
  });

  it("both manifests ship the first safe version and load answers.js before content.js", () => {
    for (const m of manifests) {
      expect(isVersionAtLeast(m.version, MIN_EXTENSION_VERSION)).toBe(true);
      expect(m.content_scripts.some((c) => c.js.join() === "answers.js,content.js")).toBe(true);
    }
  });

  it.each([undefined, "1.4.0", "1.3.0"])("gives version %s no application, hands it back as manual and refunds", async (version) => {
    const res = await checkPending(get(version));
    const body = await res.json();
    expect(body).toMatchObject({ pending: false, upgrade_required: true });
    expect(body.application).toBeUndefined();
    expect(refund).toHaveBeenCalledWith("app-1", "u1");
    expect((mdb.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join("?")).toContain("status = 'manual'");
    expect(mdb.user.findUnique).not.toHaveBeenCalled();
  });

  it("gives the current version the application", async () => {
    const body = await (await checkPending(get(MIN_EXTENSION_VERSION))).json();
    expect(body.pending).toBe(true);
    expect(refund).not.toHaveBeenCalled();
    expect(mdb.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("check-pending sends only the user's own answers", () => {
  it("holds back the six once-defaulted answers until the user has confirmed them", async () => {
    const { application } = await (await checkPending(get("1.5.0"))).json();
    expect(application).toMatchObject({
      first_name: "Dana", email: "dana@example.com",
      notice_period: null, years_of_experience: null, highest_education: null,
      work_authorized: null, requires_sponsorship: null, willing_to_relocate: null,
    });
  });

  it("sends them once confirmed", async () => {
    mdb.user.findUnique.mockResolvedValue({ ...UNTOUCHED, years_of_experience: "7", application_details_confirmed_at: new Date() });
    const { application } = await (await checkPending(get("1.5.0"))).json();
    expect(application).toMatchObject({ years_of_experience: "7", notice_period: "30", work_authorized: true });
  });

  it("sends null, not a fallback, for anything the user never set", async () => {
    mdb.user.findUnique.mockResolvedValue({
      ...UNTOUCHED, application_details_confirmed_at: new Date(),
      notice_period: null, years_of_experience: null, highest_education: null,
      work_authorized: null, requires_sponsorship: null, willing_to_relocate: null,
    });
    const { application } = await (await checkPending(get("1.5.0"))).json();
    for (const k of ["notice_period", "years_of_experience", "highest_education", "work_authorized",
      "requires_sponsorship", "willing_to_relocate", "phone", "city", "expected_salary"]) {
      expect(application[k]).toBeNull();
    }
  });
});

describe("extension answers (chrome-extension/answers.js)", () => {
  const { jaAnswerForLabel, jaBooleanAnswer, jaSavedAnswer, jaMatchOption, jaYesNoOption } = answers;
  const EMPTY = {};

  it("has no answer for anything when the user has given none", () => {
    for (const q of [
      "City", "Location", "Country", "Phone number", "Email address", "First name", "Full name",
      "Expected salary", "Desired monthly salary (NIS)", "Notice period", "When can you start?",
      "How many years of work experience do you have?", "Years of experience with React",
      "Highest level of education", "English proficiency level", "Hebrew proficiency level",
      "Do you have a security clearance?",
    ]) {
      expect(jaAnswerForLabel(q, EMPTY)).toBeNull();
    }
  });

  it("has no yes/no answer when the user has given none", () => {
    for (const q of [
      "Are you legally authorized to work in Israel?", "Will you now or in the future require visa sponsorship?",
      "Are you willing to relocate?", "Do you hold an active security clearance?",
      "Are you comfortable working in a hybrid setting?", "Can you work remotely?", "Have you worked here before?",
    ]) {
      expect(jaBooleanAnswer(q, EMPTY)).toBeNull();
    }
  });

  const PROFILE = {
    first_name: "Dana", last_name: "Levi", phone: "+972 50 000 0000", city: "Haifa", email: "dana@example.com",
    expected_salary: "25000", notice_period: "30", years_of_experience: "7", highest_education: "Master's Degree",
    work_authorized: true, requires_sponsorship: false, willing_to_relocate: false,
  };

  it("uses Profile answers for the questions they were asked as", () => {
    expect(jaAnswerForLabel("City", PROFILE)).toBe("Haifa");
    expect(jaAnswerForLabel("Full name", PROFILE)).toBe("Dana Levi");
    expect(jaAnswerForLabel("Expected monthly salary (NIS)", PROFILE)).toBe("25000");
    expect(jaAnswerForLabel("What is your notice period?", PROFILE)).toBe("30");
    expect(jaAnswerForLabel("Total years of experience", PROFILE)).toBe("7");
    expect(jaBooleanAnswer("Are you legally authorized to work in Israel?", PROFILE)).toBe(true);
    expect(jaBooleanAnswer("Will you require visa sponsorship?", PROFILE)).toBe(false);
    expect(jaBooleanAnswer("Are you willing to relocate?", PROFILE)).toBe(false);
  });

  it("doesn't stretch a Profile answer onto a different question", () => {
    // Profile's salary is monthly NIS, its work authorisation is for Israel,
    // and its years are the total — none of these are the same question.
    expect(jaAnswerForLabel("Expected annual salary (USD)", PROFILE)).toBeNull();
    expect(jaAnswerForLabel("Expected start date", PROFILE)).toBeNull();
    expect(jaAnswerForLabel("How many years of work experience do you have with Kubernetes?", PROFILE)).toBeNull();
    expect(jaAnswerForLabel("Ethnicity", PROFILE)).toBeNull();
    expect(jaAnswerForLabel("Country", PROFILE)).toBeNull();
    expect(jaBooleanAnswer("Are you legally authorized to work in the United States?", PROFILE)).toBeNull();
    expect(jaBooleanAnswer("Do you have an active security clearance?", PROFILE)).toBeNull();
  });

  it("uses an answer the user saved for that exact question", () => {
    const app = { savedAnswers: { "do you have an active security clearance?": "No" } };
    expect(jaSavedAnswer("Do you have an active security clearance? ", app)).toBe("No");
    expect(jaSavedAnswer("Do you have a driving licence?", app)).toBeNull();
  });

  it("picks an option only on a clear match, never the first one by default", () => {
    expect(jaMatchOption(["Select an option", "Yes", "No"], "No")).toBe(2);
    expect(jaMatchOption(["Select an option", "Yes", "No"], null)).toBe(-1);
    expect(jaMatchOption(["High school", "Bachelor's Degree", "Master's Degree"], "Master's Degree")).toBe(2);
    expect(jaMatchOption(["No", "Not sure"], "n")).toBe(-1);
    expect(jaYesNoOption(["Yes", "No"], false)).toBe(1);
    expect(jaYesNoOption(["כן", "לא"], true)).toBe(0);
    expect(jaYesNoOption(["Citizen", "Permanent resident"], true)).toBe(-1);
  });
});

// The extension is opened on every LinkedIn listing, and most have an
// ordinary Apply button that leaves for the company's site. Only LinkedIn's
// own Easy Apply control may be clicked; anything else means stop and report
// manual.
describe("Easy Apply button detection (chrome-extension/answers.js)", () => {
  const { jaIsEasyApplyLabel } = answers;

  it.each([
    ["the button's own text", "Easy Apply", null],
    ["text split across nodes", "  Easy\n   Apply ", ""],
    ["an aria-label naming the job", "", "Easy Apply to Senior Engineer at Acme"],
    ["the Hebrew label", "הגש מועמדות בקלות", null],
  ])("accepts %s", (_what, text, aria) => {
    expect(jaIsEasyApplyLabel(text, aria)).toBe(true);
  });

  it.each([
    ["the ordinary Apply button", "Apply", "Apply to Senior Engineer on company website"],
    ["the bare Hebrew Apply", "הגש מועמדות", null],
    ["a job card that mentions Easy Apply", "Senior Engineer Acme Tel Aviv Easy Apply", null],
    ["the Easy Apply search filter", "Easy Apply", "Easy Apply filter."],
    ["Save", "Save", "Save Senior Engineer at Acme"],
    ["nothing", null, null],
  ])("rejects %s", (_what, text, aria) => {
    expect(jaIsEasyApplyLabel(text, aria)).toBe(false);
  });
});
