// Where an auth link (OAuth callback, password-reset email) may send the user
// afterwards. `next` arrives in the URL, so it's attacker-controllable: only
// same-site paths on an allow-list, never "//evil.com" or "https://…".
const ALLOWED = [/^\/reset-password$/, /^\/dashboard(\/[\w\-/]*)?$/];

export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return ALLOWED.some((re) => re.test(next)) ? next : fallback;
}
