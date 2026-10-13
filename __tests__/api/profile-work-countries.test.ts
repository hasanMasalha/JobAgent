import { NextRequest } from "next/server";

// Profile → Right to work (2026-10-13): where the user can work and where that
// needs sponsorship later. Saving the list confirms it — only then is a
// country not on it answered "no" (ai-service/work_authorisation.py).

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));
jest.mock("@/lib/db", () => ({
  db: { user: { update: jest.fn(), findUnique: jest.fn() } },
}));

import { db } from "@/lib/db";
import { PATCH } from "@/app/api/profile/route";
import { COUNTRIES, EU_CODE, countryName, parseWorkCountries } from "@/lib/countries";

const mdb = db as unknown as { user: { update: jest.Mock; findUnique: jest.Mock } };
const patch = (body: unknown) =>
  new NextRequest("http://localhost/api/profile", { method: "PATCH", body: JSON.stringify(body) });
const saved = () => mdb.user.update.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  mdb.user.update.mockResolvedValue({});
});

describe("PATCH /api/profile work countries", () => {
  it("saves the list and confirms it", async () => {
    const res = await PATCH(patch({ work_countries: ["IL", "GB", "IL"], sponsorship_later_countries: ["GB"] }));
    expect(res.status).toBe(200);
    expect(saved()).toMatchObject({ work_countries: ["IL", "GB"], sponsorship_later_countries: ["GB"] });
    expect(saved().work_auth_confirmed_at).toBeInstanceOf(Date);
    expect(saved().application_details_confirmed_at).toBeInstanceOf(Date);
  });

  it("takes an EU citizen's entry", async () => {
    await PATCH(patch({ work_countries: [EU_CODE] }));
    expect(saved()).toMatchObject({ work_countries: ["EU"], sponsorship_later_countries: [] });
  });

  it("treats an empty list as no answer, not as nowhere", async () => {
    await PATCH(patch({ work_countries: [], sponsorship_later_countries: [] }));
    expect(saved().work_countries).toEqual([]);
    expect(saved().work_auth_confirmed_at).toBeNull();
  });

  it.each([
    ["an unknown code", { work_countries: ["XX"] }],
    ["a name instead of a code", { work_countries: ["Israel"] }],
    ["not a list", { work_countries: "IL" }],
    ["sponsorship in a country not listed", { work_countries: ["IL"], sponsorship_later_countries: ["US"] }],
  ])("rejects %s and saves nothing", async (_what, body) => {
    const res = await PATCH(patch(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_work_countries");
    expect(mdb.user.update).not.toHaveBeenCalled();
  });

  it("no longer takes the old Israel-only answers", async () => {
    await PATCH(patch({ work_authorized: false, requires_sponsorship: true, city: "Haifa" }));
    expect(saved()).not.toHaveProperty("work_authorized");
    expect(saved()).not.toHaveProperty("requires_sponsorship");
  });

  it("approving on the review screen confirms the list it showed", async () => {
    mdb.user.findUnique.mockResolvedValue({ work_countries: ["IL"] });
    await PATCH(patch({ confirm_application_details: true }));
    expect(saved().work_auth_confirmed_at).toBeInstanceOf(Date);
    expect(saved().work_countries).toEqual(["IL"]);
    expect(saved()).not.toHaveProperty("sponsorship_later_countries");
  });

  it("approving with no list confirms no list", async () => {
    mdb.user.findUnique.mockResolvedValue({ work_countries: [] });
    await PATCH(patch({ confirm_application_details: true }));
    expect(saved()).not.toHaveProperty("work_auth_confirmed_at");
  });
});

describe("lib/countries", () => {
  it("has the countries the AI service knows, by name", () => {
    expect(COUNTRIES.length).toBeGreaterThan(200);
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("IL")).toBe("Israel");
    expect(countryName(EU_CODE)).toMatch(/EU/);
  });

  it("parses a list of codes", () => {
    expect(parseWorkCountries(["US", "US", "EU"])).toEqual(["US", "EU"]);
    expect(parseWorkCountries(["us"])).toBeNull();
    expect(parseWorkCountries(null)).toBeNull();
  });
});
