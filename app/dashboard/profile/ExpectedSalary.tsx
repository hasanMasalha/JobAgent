"use client";

import { Field, Input, Select } from "@/app/components/ui";
import { CURRENCIES, PERIOD_LABEL, SALARY_PERIODS, convertExample, type SalaryPeriod } from "@/lib/salary";

// Profile → Expected salary: amount, currency and period, gross. The AI
// service gives it in whatever units a question asks for (ai-service/salary.py):
// month ↔ year always, another currency only with the box ticked, never to or
// from hourly. Nothing is preselected.

export interface SalaryValue {
  amount: string;
  currency: string;
  period: string;
  convert: boolean;
}

export function ExpectedSalary({
  value,
  onChange,
  rates,
}: {
  value: SalaryValue;
  onChange: (next: SalaryValue) => void;
  rates: { date: string; per_eur: Record<string, number> } | null;
}) {
  const amount = Number(value.amount.replace(/[,\s]/g, ""));
  const complete = Number.isInteger(amount) && amount > 0 && value.currency && value.period;
  const exampleTo = value.currency === "USD" ? "EUR" : "USD";
  const example =
    complete && rates
      ? convertExample({ amount, currency: value.currency, period: value.period as SalaryPeriod }, exampleTo, rates.per_eur)
      : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field id="salary-amount" label="Expected salary (gross)">
          <Input
            inputMode="numeric"
            value={value.amount}
            onChange={(e) => onChange({ ...value, amount: e.target.value })}
            placeholder="e.g. 20000"
          />
        </Field>
        <Field id="salary-currency" label="Currency">
          <Select value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })}>
            <option value="">Choose…</option>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="salary-period" label="Period">
          <Select value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value })}>
            <option value="">Choose…</option>
            {SALARY_PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="text-body-sm text-ink-muted">
        JobAgent answers a yearly or monthly question from this (×12 between them). It doesn&apos;t
        convert to or from an hourly rate, and doesn&apos;t answer a question about net or take-home
        pay, bonus or total compensation — those are left for you.
      </p>

      <label className="flex cursor-pointer items-start gap-2.5 text-body-sm text-ink">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={value.convert}
          onChange={(e) => onChange({ ...value, convert: e.target.checked })}
        />
        <span>
          Let JobAgent convert this to other currencies at the day&apos;s rate
          {example && (
            <span className="text-ink-muted">
              {" "}
              (e.g. ≈ {example.amount.toLocaleString("en-US")} {example.currency} a year)
            </span>
          )}
          <span className="mt-0.5 block text-ink-muted">
            The European Central Bank&apos;s reference rate, rounded. Off: a question in another currency
            stops and asks you.
          </span>
        </span>
      </label>
    </div>
  );
}
