import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * True when the request carries INTERNAL_API_KEY in `header`. For routes only
 * the AI service or an operator should call (email triggers, admin jobs).
 *
 * Deliberately no "is it local?" shortcut: Host and X-Forwarded-For are set
 * by the caller, and Next.js is reachable directly on port 3000, so a
 * request claiming to be localhost proves nothing. Fails closed when the key
 * is unset. Compares SHA-256 digests so the comparison is constant-time
 * regardless of input length.
 */
export function isInternalRequest(req: NextRequest, header: "x-internal-key" | "x-api-key" = "x-internal-key"): boolean {
  const key = process.env.INTERNAL_API_KEY;
  const given = req.headers.get(header);
  if (!key || !given) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(key));
}
