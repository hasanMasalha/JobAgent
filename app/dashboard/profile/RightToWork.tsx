"use client";

import { useId, useState } from "react";
import { Input, Notice, RemovableTag } from "@/app/components/ui";
import { cn } from "@/lib/cn";
import { COUNTRIES, EU_CODE, EU_LABEL, countryName } from "@/lib/countries";

// Profile → Right to work. Where the user can work now, and where that will
// need an employer's sponsorship later. The AI service answers "authorised to
// work in X?" and "will you need sponsorship in X?" from these, for the
// country the question or the job is about (ai-service/work_authorisation.py).
// A country not listed is answered "no" / "needs sponsorship", so the list has
// to be complete — the copy says so.

const OPTIONS = [{ code: EU_CODE, name: EU_LABEL }, ...COUNTRIES];
const BY_NAME = new Map(OPTIONS.map((o) => [o.name.toLowerCase(), o.code]));

export function RightToWork({
  countries,
  later,
  confirmed,
  onChange,
}: {
  countries: string[];
  later: string[];
  confirmed: boolean;
  onChange: (next: { countries: string[]; later: string[] }) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  // "Yes, in:" stays open while the user picks, even with nothing ticked yet.
  const [askLater, setAskLater] = useState(later.length > 0);
  const showLater = askLater || later.length > 0;

  function add(value: string) {
    const code = BY_NAME.get(value.trim().toLowerCase());
    if (!code) return false;
    if (!countries.includes(code)) onChange({ countries: [...countries, code], later });
    setQuery("");
    return true;
  }

  function remove(code: string) {
    onChange({ countries: countries.filter((c) => c !== code), later: later.filter((c) => c !== code) });
  }

  function toggleLater(code: string, on: boolean) {
    onChange({ countries, later: on ? [...later, code] : later.filter((c) => c !== code) });
  }

  return (
    <div className="space-y-5">
      {countries.length > 0 && !confirmed && (
        <Notice tone="attention" title="Check this list and save">
          Until you do, JobAgent answers right-to-work questions only for Israel, as before, and leaves
          the rest for you.
        </Notice>
      )}

      <div>
        <label htmlFor={`${listId}-input`} className="text-body-sm font-medium text-ink">
          Countries where you can work now
        </label>
        <p className="mt-1 text-body-sm text-ink-muted">
          List every one. For a country that isn&apos;t here, JobAgent answers that you aren&apos;t
          authorised to work there and would need sponsorship.
        </p>
        {countries.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {countries.map((c) => (
              <RemovableTag key={c} label={countryName(c)} onRemove={() => remove(c)} />
            ))}
          </div>
        )}
        <Input
          id={`${listId}-input`}
          className="mt-2.5 sm:max-w-sm"
          list={`${listId}-options`}
          value={query}
          placeholder="Add a country…"
          autoComplete="off"
          onChange={(e) => {
            // Picking from the list fills in an exact name: add it straight away.
            if (!add(e.target.value)) setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(query);
            }
          }}
        />
        <datalist id={`${listId}-options`}>
          {OPTIONS.filter((o) => !countries.includes(o.code)).map((o) => (
            <option key={o.code} value={o.name} />
          ))}
        </datalist>
        {countries.length === 0 && (
          <p className="mt-2 text-body-sm italic text-ink-subtle">
            Not set: JobAgent leaves right-to-work and sponsorship questions for you.
          </p>
        )}
      </div>

      {countries.length > 0 && (
        <fieldset>
          <legend className="text-body-sm font-medium text-ink">
            Will any of these need an employer to sponsor a visa later?
          </legend>
          <p className="mt-1 text-body-sm text-ink-muted">
            For example a work visa such as an H-1B or a UK Skilled Worker visa, rather than citizenship or
            permanent residence.
          </p>
          <div className="mt-2.5 space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-body-sm text-ink">
              <input
                type="radio"
                name={`${listId}-later`}
                checked={!showLater}
                onChange={() => {
                  setAskLater(false);
                  onChange({ countries, later: [] });
                }}
              />
              No — I&apos;m a citizen or permanent resident in all of them
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-body-sm text-ink">
              <input type="radio" name={`${listId}-later`} checked={showLater} onChange={() => setAskLater(true)} />
              Yes, in:
            </label>
            {showLater && (
              <div className="ml-6 flex flex-wrap gap-x-4 gap-y-2">
                {countries.map((c) => (
                  <label key={c} className={cn("flex cursor-pointer items-center gap-2 text-body-sm text-ink")}>
                    <input
                      type="checkbox"
                      checked={later.includes(c)}
                      onChange={(e) => toggleLater(c, e.target.checked)}
                    />
                    {countryName(c)}
                  </label>
                ))}
              </div>
            )}
          </div>
        </fieldset>
      )}
    </div>
  );
}
