// Password reset: the email link lands on /auth/confirm (or /auth/callback),
// which may only continue to allow-listed same-site paths — `next` is in the
// URL, so it must never become an open redirect.

const verifyOtp = jest.fn();
const exchangeCodeForSession = jest.fn();
jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { verifyOtp, exchangeCodeForSession } }),
}));

import { safeNextPath } from "@/lib/safe-next";
import { GET as confirm } from "@/app/auth/confirm/route";
import { GET as callback } from "@/app/auth/callback/route";

const APP = "https://jobagent.uk";
beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = APP;
});
const location = (res: Response) => res.headers.get("location");

describe("safeNextPath", () => {
  it.each(["/reset-password", "/dashboard", "/dashboard/profile", "/dashboard/apply/abc-123"])("allows %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });

  it.each([
    "https://evil.com", "//evil.com", "/\\evil.com", "evil.com", "/login", "/reset-password/../../x",
    "/dashboard?x=//evil.com", "/api/admin/cleanup-jobs", "", null, undefined,
  ])("falls back for %p", (p) => {
    expect(safeNextPath(p as string)).toBe("/dashboard");
  });
});

describe("GET /auth/confirm", () => {
  const url = (q: string) => new Request(`${APP}/auth/confirm?${q}`);

  it("verifies the token and continues to the reset page", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await confirm(url("token_hash=abc&type=recovery&next=/reset-password"));
    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc" });
    expect(location(res)).toBe(`${APP}/reset-password`);
  });

  it("sends an expired or reused recovery link back to request a new one", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const res = await confirm(url("token_hash=abc&type=recovery&next=/reset-password"));
    expect(location(res)).toBe(`${APP}/forgot-password?error=expired`);
  });

  it("ignores an off-site next", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await confirm(url("token_hash=abc&type=recovery&next=https://evil.com"));
    expect(location(res)).toBe(`${APP}/dashboard`);
  });

  it("doesn't call Supabase without a token", async () => {
    const res = await confirm(url("type=recovery"));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(location(res)).toBe(`${APP}/forgot-password?error=expired`);
  });
});

describe("GET /auth/callback", () => {
  it("still sends OAuth sign-ins to the dashboard", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await callback(new Request(`${APP}/auth/callback?code=c1`));
    expect(location(res)).toBe(`${APP}/dashboard`);
  });

  it("continues a same-browser reset link to the reset page", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await callback(new Request(`${APP}/auth/callback?code=c1&next=/reset-password`));
    expect(location(res)).toBe(`${APP}/reset-password`);
  });

  it("ignores an off-site next", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await callback(new Request(`${APP}/auth/callback?code=c1&next=//evil.com`));
    expect(location(res)).toBe(`${APP}/dashboard`);
  });
});
