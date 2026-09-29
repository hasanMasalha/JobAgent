"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase";
import { Button, Field, Input, Notice } from "@/app/components/ui";
import { AuthShell, authLink } from "../AuthShell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).get("error") === "expired");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createBrowserClient();
    // The email template links to /auth/confirm (works on any device); this
    // redirectTo is the fallback for Supabase's default template.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    // Rate limits and bad addresses are worth showing; "no such user" isn't
    // an error Supabase returns, so the success message never reveals whether
    // an account exists.
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle="The link is valid for one hour.">
        <p className="text-body text-ink-muted">
          If there&apos;s a JobAgent account for <strong className="font-semibold text-ink">{email}</strong>, we&apos;ve sent it a link to choose a new password.
        </p>
        <p className="mt-6 text-body-sm text-ink-muted">
          Nothing arrived? Check spam, or <button type="button" onClick={() => setSent(false)} className={authLink}>try again</button>.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      {expired && (
        <Notice tone="attention" className="mb-5">That reset link has expired or was already used. Request a new one below.</Notice>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field id="forgot-email" label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" size="lg" block disabled={loading} loading={loading}>
          {loading ? "Sending…" : "Send reset link"}
        </Button>
      </form>
      <p className="mt-6 text-center text-body-sm text-ink-muted">
        Remembered it? <Link href="/login" className={authLink}>Sign in</Link>
      </p>
    </AuthShell>
  );
}
