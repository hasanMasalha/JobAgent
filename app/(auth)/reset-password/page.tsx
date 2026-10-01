"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase";
import { Button, Field, Input, Notice, Spinner, buttonStyles } from "@/app/components/ui";
import { AuthShell } from "../AuthShell";

// Reached from the password-reset email via /auth/confirm or /auth/callback,
// which have already turned the link into a session. Without one, the link
// was bad or expired.
export default function ResetPasswordPage() {
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    createBrowserClient()
      .auth.getUser()
      .then(({ data }) => setHasSession(!!data.user))
      .finally(() => setChecking(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setLoading(true);
    const { error } = await createBrowserClient().auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  }

  if (checking) {
    return (
      <AuthShell title="Choose a new password" subtitle="Checking your reset link…">
        <Spinner label="Checking your reset link" />
      </AuthShell>
    );
  }

  if (!hasSession) {
    return (
      <AuthShell title="This link has expired" subtitle="Reset links work once and last an hour.">
        <Link href="/forgot-password" className={buttonStyles({ size: "lg", block: true })}>Send a new link</Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password changed" subtitle="You're signed in with your new password.">
        <Link href="/dashboard" className={buttonStyles({ size: "lg", block: true })}>Continue to JobAgent</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="You'll use it the next time you sign in.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field id="reset-password" label="New password" hint="At least 6 characters.">
          <Input type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field id="reset-confirm" label="Confirm new password">
          <Input type="password" autoComplete="new-password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" size="lg" block disabled={loading} loading={loading}>
          {loading ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </AuthShell>
  );
}
