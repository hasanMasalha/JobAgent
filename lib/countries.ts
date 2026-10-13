import data from "@/ai-service/data/countries.json";

// The countries for Profile → Right to work. The same file the AI service
// answers from (ai-service/work_authorisation.py), so a code saved here is one
// it knows.

export const EU_CODE = "EU";
export const EU_LABEL = "EU / EEA / Switzerland (EU citizen)";

export const COUNTRIES: { code: string; name: string }[] = [...data.countries]
  .map(({ code, name }) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const NAMES = new Map(COUNTRIES.map((c) => [c.code, c.name]));
NAMES.set(EU_CODE, EU_LABEL);

export function isWorkCountry(code: unknown): code is string {
  return typeof code === "string" && NAMES.has(code);
}

export function countryName(code: string): string {
  return NAMES.get(code) ?? code;
}

/** A list of codes from a request body: known ones only, once each, in order.
 *  null when the value isn't a list of strings at all. */
export function parseWorkCountries(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return null;
  if (value.some((v) => !isWorkCountry(v))) return null;
  return Array.from(new Set(value as string[]));
}
