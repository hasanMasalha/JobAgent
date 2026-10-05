// The Profile phone number, checked the way the AI service reads it
// (ai-service/phone_country.py): application forms ask for the phone's
// country, and JobAgent takes it from the number, so the number has to name
// its country. Server-side only — the full metadata needed to tell the US
// from Canada, or the UK from Guernsey, is too big to ship to the browser.
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export const PHONE_HINT = "Include your country code, e.g. +44 7400 123456 or +1 202 555 0123.";

/**
 * Why this phone number can't be used, or null if it can (or is empty).
 *
 * - "+44 …" / "0044 …": its country must be known — for a dial code several
 *   countries share (+1, +44, +7) that means a valid number.
 * - No country code: only an Israeli number ("05…", or any valid one) —
 *   Profile asked Israeli users for local format before.
 */
export function phoneProblem(raw: string | null | undefined): string | null {
  const compact = (raw ?? "").replace(/[\s\-().]/g, "");
  if (!compact) return null;

  if (compact.startsWith("+") || compact.startsWith("00")) {
    const number = parsePhoneNumberFromString(compact.startsWith("00") ? `+${compact.slice(2)}` : compact);
    if (!number || !number.isPossible()) return "That doesn't look like a phone number. Check the digits and the country code.";
    if (!number.country) return "We can't tell which country this number belongs to. Check the number and its country code.";
    return null;
  }

  if (compact.startsWith("0")) {
    const israeli = parsePhoneNumberFromString(compact, "IL");
    if (israeli?.isPossible() && (compact.startsWith("05") || israeli.isValid())) return null;
  }
  return `Add your country code. ${PHONE_HINT}`;
}
