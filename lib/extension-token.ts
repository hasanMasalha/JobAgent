import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase.server";

// Proof of identity for the Chrome extension.
//
// The extension's service worker can't send the site's session cookie, so
// the routes it calls used to accept a bare `userId` from the query or body
// — anyone who knew a user's id could act as them. Instead, /api/auth/me
// (called from the logged-in site by the extension's auth-sync script) hands
// out a short-lived HMAC-signed token for the session's user, and the
// extension sends it as `Authorization: Bearer <token>`.
//
// Format: v1.<userId base64url>.<expiry unix seconds>.<HMAC-SHA256 base64url>
// Signed with EXTENSION_TOKEN_SECRET. If the secret is unset, tokens can't be
// issued or verified — extension calls fail closed rather than open.

const VERSION = "v1";
export const EXTENSION_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;

function secret(): string | null {
  const s = process.env.EXTENSION_TOKEN_SECRET;
  if (!s || s.length < 32) {
    console.error("[extension-token] EXTENSION_TOKEN_SECRET is missing or shorter than 32 characters");
    return null;
  }
  return s;
}

const sign = (payload: string, key: string) => createHmac("sha256", key).update(payload).digest("base64url");

export function createExtensionToken(userId: string, nowMs = Date.now()): string | null {
  const key = secret();
  if (!key || !userId) return null;
  const exp = Math.floor(nowMs / 1000) + EXTENSION_TOKEN_TTL_SECONDS;
  const payload = `${VERSION}.${Buffer.from(userId).toString("base64url")}.${exp}`;
  return `${payload}.${sign(payload, key)}`;
}

/** The user id a valid, unexpired token was issued for; null otherwise. */
export function verifyExtensionToken(token: string | null | undefined, nowMs = Date.now()): string | null {
  if (!token) return null;
  const key = secret();
  if (!key) return null;

  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, uid, expStr, sig] = parts;

  const expected = Buffer.from(sign(`${VERSION}.${uid}.${expStr}`, key));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp * 1000 <= nowMs) return null;

  const userId = Buffer.from(uid, "base64url").toString();
  return userId || null;
}

function bearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/**
 * The caller's user id for routes the extension calls: the session user if
 * there's a session, otherwise the user a valid extension token was issued
 * for. Never a caller-supplied id.
 */
export async function getSessionOrExtensionUserId(req: NextRequest): Promise<string | null> {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return user.id;
  return verifyExtensionToken(bearerToken(req));
}
