"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase";

const NAVY = "#1a2e5e";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createBrowserClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Sync token to extension via cookie + postMessage (no extension ID needed)
    if (data.session) {
      try {
        const token = data.session.access_token;
        const userId = data.session.user.id;
        document.cookie = `jobagent_token=${token}; path=/; max-age=86400; SameSite=Lax`;
        document.cookie = `jobagent_user_id=${userId}; path=/; max-age=86400; SameSite=Lax`;
        window.postMessage({ type: "JOBAGENT_AUTH", token, userId }, "*");
      } catch {
        // ignore
      }
    }

    router.push("/dashboard");
  }

  async function handleGoogleSignIn() {
    const supabase = createBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });
  }

  const formPanel = (
    <>
      <h1 style={{ fontSize: 18, fontWeight: 500, marginBottom: 4, color: "#111" }}>
        Welcome back
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>
        Sign in to continue to JobAgent
      </p>

      {/* Google button */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          padding: "10px 16px",
          background: "white",
          color: "#111",
          fontSize: 14,
          fontWeight: 500,
          cursor: "pointer",
          marginBottom: 16,
          boxSizing: "border-box",
        }}
      >
        <svg viewBox="0 0 24 24" style={{ width: 20, height: 20, flexShrink: 0 }}>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <div style={{ flex: 1, height: 1, background: "#e0e0e0" }} />
        <span style={{ padding: "0 12px", fontSize: 12, color: "#9ca3af" }}>or</span>
        <div style={{ flex: 1, height: 1, background: "#e0e0e0" }} />
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, color: "#6b7280", marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{
              width: "100%",
              background: "#f5f6f8",
              border: "1px solid #e0e0e0",
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 14,
              color: "#111",
              boxSizing: "border-box",
              outline: "none",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = NAVY;
              e.target.style.background = "white";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "#e0e0e0";
              e.target.style.background = "#f5f6f8";
            }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, color: "#6b7280", marginBottom: 6 }}>
            Password
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{
              width: "100%",
              background: "#f5f6f8",
              border: "1px solid #e0e0e0",
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 14,
              color: "#111",
              boxSizing: "border-box",
              outline: "none",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = NAVY;
              e.target.style.background = "white";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "#e0e0e0";
              e.target.style.background = "#f5f6f8";
            }}
          />
        </div>

        {/* Remember me + Forgot password */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6b7280", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              style={{ accentColor: NAVY }}
            />
            Remember me
          </label>
          <a href="#" style={{ fontSize: 13, color: NAVY, textDecoration: "none" }}>
            Forgot password?
          </a>
        </div>

        {error && (
          <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            background: NAVY,
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "11px 0",
            fontSize: 14,
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
            boxSizing: "border-box",
          }}
          onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.opacity = "0.88"; }}
          onMouseLeave={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p style={{ marginTop: 20, fontSize: 13, color: "#6b7280", textAlign: "center" }}>
        No account?{" "}
        <Link href="/signup" style={{ color: NAVY, textDecoration: "underline" }}>
          Sign up
        </Link>
      </p>
    </>
  );

  return (
    <>
      {/* ── Desktop: two-panel layout ── */}
      <div className="hidden md:flex min-h-screen">
        {/* Left brand panel */}
        <div className="hidden md:flex md:w-1/2 bg-[#1a2e5e] flex-col justify-between p-12 relative overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute rounded-full border-[40px] border-white/10 w-96 h-96 -bottom-20 -left-20" />
          <div className="absolute rounded-full border-[32px] border-white/10 w-72 h-72 -top-16 -right-12" />
          <div className="absolute rounded-full border-[22px] border-white/10 w-52 h-52" style={{ top: 72, left: "42%" }} />

          {/* Logo */}
          <div style={{ position: "relative", zIndex: 1 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/whiteLogo.png" alt="JobAgent" style={{maxWidth: '180px'}} />
          </div>

          {/* Heading + bullets */}
          <div style={{ position: "relative", zIndex: 1 }}>
            <h2 style={{ color: "white", fontSize: 22, fontWeight: 500, margin: "0 0 10px" }}>
              Find your next role, faster.
            </h2>
            <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, margin: "0 0 40px" }}>
              Your AI-powered career assistant for the Israeli job market.
            </p>

            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                "Personalised job recommendations daily",
                "One-click applications to top employers",
                "Real-time alerts when new roles match your profile",
                "CV and cover letter tools built in",
              ].map((item) => (
                <li key={item} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: "rgba(255,255,255,0.35)", flexShrink: 0,
                  }} />
                  <span style={{ color: "white", fontSize: 13.5 }}>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, position: "relative", zIndex: 1 }}>
            © 2026 JobAgent. All rights reserved.
          </p>
        </div>

        {/* Right form panel */}
        <div className="w-full md:w-1/2 flex items-center justify-center bg-white p-8">
          <div className="w-full max-w-sm">
            {formPanel}
          </div>
        </div>
      </div>

      {/* ── Mobile: single card ── */}
      <div
        className="flex md:hidden"
        style={{
          minHeight: "100vh",
          background: "#f4f5f7",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 16px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="JobAgent" style={{maxWidth: '180px', marginBottom: 24}} />
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            background: "white",
            borderRadius: 12,
            boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
            padding: "28px 28px",
            boxSizing: "border-box",
          }}
        >
          {formPanel}
        </div>
      </div>
    </>
  );
}
