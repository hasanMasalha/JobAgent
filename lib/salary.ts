import data from "@/ai-service/data/currencies.json";

// Profile → Expected salary: amount, currency, period (gross). The AI service
// answers salary questions from these in the units each question asks for
// (ai-service/salary.py), converting currency only when the user allows it.

export const CURRENCIES: { code: string; name: string }[] = data.currencies;
export const SALARY_PERIODS = ["year", "month", "hour"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const PERIOD_LABEL: Record<SalaryPeriod, string> = { year: "per year", month: "per month", hour: "per hour" };

const CODES = new Set(CURRENCIES.map((c) => c.code));

export interface ExpectedSalary {
  amount: number;
  currency: string;
  period: SalaryPeriod;
}

/** A salary from a request body, `null` to clear it, or an error message. */
export function parseSalary(body: {
  salary_amount?: unknown;
  salary_currency?: unknown;
  salary_period?: unknown;
}): ExpectedSalary | null | { error: string } {
  const raw = body.salary_amount;
  if (raw === null || raw === "" || raw === undefined) return null;
  const amount = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[,\s]/g, "")) : NaN;
  if (!Number.isInteger(amount) || amount <= 0 || amount > 999_999_999) {
    return { error: "Enter your expected salary as a whole number, without the currency." };
  }
  const currency = body.salary_currency;
  const period = body.salary_period;
  if (typeof currency !== "string" || !CODES.has(currency)) return { error: "Choose the salary's currency." };
  if (typeof period !== "string" || !(SALARY_PERIODS as readonly string[]).includes(period)) {
    return { error: "Choose whether the salary is per year, per month or per hour." };
  }
  return { amount, currency, period: period as SalaryPeriod };
}

export function formatSalary(s: ExpectedSalary): string {
  return `${s.amount.toLocaleString("en-US")} ${s.currency} ${PERIOD_LABEL[s.period]}`;
}

/** The old "Expected salary (monthly, NIS)" text for extension 1.6.x, which
 *  types it only into a question asking for a monthly NIS figure. */
export function legacyMonthlyNis(s: Partial<ExpectedSalary> | null): string | null {
  return s && s.amount && s.currency === "ILS" && s.period === "month" ? String(s.amount) : null;
}

/** What conversion would give, for the Profile's example: the same rule as
 *  salary.py (×12 between month and year, never hourly; rounded to 1,000 a
 *  year / 100 a month). null when it can't be worked out. */
export function convertExample(
  s: ExpectedSalary,
  to: string,
  perEur: Record<string, number>,
): { amount: number; currency: string; period: SalaryPeriod } | null {
  const src = perEur[s.currency];
  const dst = perEur[to];
  if (!src || !dst || s.period === "hour") return null;
  const yearly = (s.period === "month" ? s.amount * 12 : s.amount) * (dst / src);
  return { amount: Math.round(yearly / 1000) * 1000, currency: to, period: "year" };
}
