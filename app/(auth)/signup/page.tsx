"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase";
import { Button, Field, Input, Notice } from "@/app/components/ui";
import { AuthShell, GoogleButton, OrDivider, authLink } from "../AuthShell";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createBrowserClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Email confirmation disabled — signUp already returned an active session,
    // so there's no confirmation email coming. Go straight to onboarding.
    if (data.session) {
      router.push("/dashboard/onboarding");
      return;
    }

    setDone(true);
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

  if (done) {
    return (
      <AuthShell title="Check your email" subtitle="One more step before you can sign in.">
        <p className="text-body text-ink-muted">
          We sent a confirmation link to <strong className="font-semibold text-ink">{email}</strong>.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Set up JobAgent in a few minutes.">
      <GoogleButton onClick={handleGoogleSignIn} />
      <OrDivider />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field id="signup-name" label="Name">
          <Input type="text" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </Field>
        <Field id="signup-email" label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </Field>
        <Field id="signup-password" label="Password" hint="At least 6 characters.">
          <Input type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>

        {error && <Notice tone="danger">{error}</Notice>}

        <Button type="submit" size="lg" block disabled={loading} loading={loading}>
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="mt-4 text-center text-caption text-ink-subtle">
        By creating an account you agree to our{" "}
        <Link href="/legal/terms" className={authLink}>Terms of Service</Link> and{" "}
        <Link href="/legal/privacy" className={authLink}>Privacy Policy</Link>.
      </p>

      <p className="mt-6 text-center text-body-sm text-ink-muted">
        Already have an account? <Link href="/login" className={authLink}>Sign in</Link>
      </p>
    </AuthShell>
  );
}
