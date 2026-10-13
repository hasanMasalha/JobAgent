import { NextRequest } from "next/server";

// Profile → Expected salary (2026-10-13): amount, currency and period, gross.
// The AI service answers in the units a question asks for (ai-service/salary.py).

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));
jest.mock("@/lib/db", () => ({
  db: { user: { update: jest.fn(), findUnique: jest.fn() } },
}));

import { db } from "@/lib/db";
import { PATCH } from "@/app/api/profile/route";
import { CURRENCIES, convertExample, formatSalary, legacyMonthlyNis, parseSalary } from "@/lib/salary";

const mdb = db as unknown as { user: { update: jest.Mock } };
const patch = (body: unknown) =>
  new NextRequest("http://localhost/api/profile", { method: "PATCH", body: JSON.stringify(body) });
const saved = () => mdb.user.update.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  mdb.user.update.mockResolvedValue({});
});

describe("PATCH /api/profile salary", () => {
  it("saves amount, currency, period and the conversion setting", async () => {
    const res = await PATCH(patch({
      salary_amount: "20,000", salary_currency: "ILS", salary_period: "month", salary_convert_currency: true,
    }));
    expect(res.status).toBe(200);
    expect(saved()).toMatchObject({
      salary_amount: 20000, salary_currency: "ILS", salary_period: "month", salary_convert_currency: true,
    });
  });

  it("clears all three when the amount is empty", async () => {
    await PATCH(patch({ salary_amount: null, salary_currency: "ILS", salary_period: "month" }));
    expect(saved()).toMatchObject({ salary_amount: null, salary_currency: null, salary_period: null });
  });

  it.each([
    ["a non-number", { salary_amount: "20k", salary_currency: "ILS", salary_period: "month" }],
    ["a decimal", { salary_amount: 20000.5, salary_currency: "ILS", salary_period: "month" }],
    ["zero", { salary_amount: 0, salary_currency: "ILS", salary_period: "month" }],
    ["no currency", { salary_amount: 20000, salary_period: "month" }],
    ["an unknown currency", { salary_amount: 20000, salary_currency: "XYZ", salary_period: "month" }],
    ["an unknown period", { salary_amount: 20000, salary_currency: "ILS", salary_period: "week" }],
    ["a conversion setting that isn't true/false", { salary_convert_currency: "yes" }],
  ])("rejects %s and saves nothing", async (_what, body) => {
    const res = await PATCH(patch(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_salary");
    expect(mdb.user.update).not.toHaveBeenCalled();
  });

  it("no longer writes the old monthly-NIS text", async () => {
    await PATCH(patch({ expected_salary: "25000", city: "Haifa" }));
    expect(saved()).not.toHaveProperty("expected_salary");
  });
});

describe("lib/salary", () => {
  it("has the ECB currencies the AI service converts", () => {
    expect(CURRENCIES.map((c) => c.code)).toEqual(expect.arrayContaining(["ILS", "USD", "EUR", "GBP"]));
    expect(parseSalary({ salary_amount: "1 500", salary_currency: "USD", salary_period: "hour" }))
      .toEqual({ amount: 1500, currency: "USD", period: "hour" });
  });

  it("gives extension 1.6.x a salary only when it is monthly NIS", () => {
    expect(legacyMonthlyNis({ amount: 20000, currency: "ILS", period: "month" })).toBe("20000");
    expect(legacyMonthlyNis({ amount: 240000, currency: "ILS", period: "year" })).toBeNull();
    expect(legacyMonthlyNis({ amount: 5000, currency: "USD", period: "month" })).toBeNull();
    expect(legacyMonthlyNis(null)).toBeNull();
  });

  it("works out the Profile's example the way salary.py converts", () => {
    const rates = { EUR: 1, ILS: 4, USD: 1.08 };
    expect(convertExample({ amount: 20000, currency: "ILS", period: "month" }, "USD", rates))
      .toEqual({ amount: 65000, currency: "USD", period: "year" });
    expect(convertExample({ amount: 50, currency: "USD", period: "hour" }, "EUR", rates)).toBeNull();
    expect(convertExample({ amount: 20000, currency: "ILS", period: "month" }, "JPY", rates)).toBeNull();
    expect(formatSalary({ amount: 20000, currency: "ILS", period: "month" })).toBe("20,000 ILS per month");
  });
});
