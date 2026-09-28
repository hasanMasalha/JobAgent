jest.mock("@/lib/supabase.server", () => ({ createServerClient: jest.fn() }));

import { createExtensionToken, verifyExtensionToken, EXTENSION_TOKEN_TTL_SECONDS } from "@/lib/extension-token";

const SECRET = "test-secret-that-is-at-least-32-characters-long";

beforeEach(() => {
  process.env.EXTENSION_TOKEN_SECRET = SECRET;
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("extension tokens", () => {
  it("round-trips the user id it was issued for", () => {
    const token = createExtensionToken("user-123")!;
    expect(verifyExtensionToken(token)).toBe("user-123");
  });

  it("rejects a token whose user id was swapped", () => {
    const [v, , exp, sig] = createExtensionToken("user-123")!.split(".");
    const forged = [v, Buffer.from("victim-456").toString("base64url"), exp, sig].join(".");
    expect(verifyExtensionToken(forged)).toBeNull();
  });

  it("rejects a token whose expiry was extended", () => {
    const [v, uid, exp, sig] = createExtensionToken("user-123")!.split(".");
    expect(verifyExtensionToken([v, uid, String(Number(exp) + 86400), sig].join("."))).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    process.env.EXTENSION_TOKEN_SECRET = "a-completely-different-secret-of-32-chars!";
    const other = createExtensionToken("user-123")!;
    process.env.EXTENSION_TOKEN_SECRET = SECRET;
    expect(verifyExtensionToken(other)).toBeNull();
  });

  it("expires after the TTL", () => {
    const now = Date.now();
    const token = createExtensionToken("user-123", now)!;
    expect(verifyExtensionToken(token, now + (EXTENSION_TOKEN_TTL_SECONDS - 60) * 1000)).toBe("user-123");
    expect(verifyExtensionToken(token, now + (EXTENSION_TOKEN_TTL_SECONDS + 1) * 1000)).toBeNull();
  });

  it.each(["", "garbage", "v1.a.b", "v2.dXNlcg.9999999999.sig", "user-123"])("rejects malformed token %p", (t) => {
    expect(verifyExtensionToken(t)).toBeNull();
  });

  it("fails closed when the secret is missing or short", () => {
    const token = createExtensionToken("user-123")!;
    delete process.env.EXTENSION_TOKEN_SECRET;
    expect(createExtensionToken("user-123")).toBeNull();
    expect(verifyExtensionToken(token)).toBeNull();
    process.env.EXTENSION_TOKEN_SECRET = "short";
    expect(verifyExtensionToken(token)).toBeNull();
  });
});
