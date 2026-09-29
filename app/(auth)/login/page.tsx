"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase";
import { Button, Field, Input, Notice } from "@/app/components/ui";
import { AuthShell, GoogleButton, OrDivider, authLink } from "../AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // This page used to copy the Supabase access token into a JS-readable
    // cookie and postMessage it to "*" for the extension. Nothing read either
    // (the extension authenticates with the signed token from /api/auth/me),
    // so it's gone; expire any copies left in browsers from before.
    document.cookie = "jobagent_token=; path=/; max-age=0; SameSite=Lax";
    document.cookie = "jobagent_user_id=; path=/; max-age=0; SameSite=Lax";

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

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to continue to JobAgent.">
      <GoogleButton onClick={handleGoogleSignIn} />
      <OrDivider />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field id="login-email" label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </Field>
        <div>
          <Field id="login-password" label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="mt-2 flex justify-end">
            <Link href="/forgot-password" className={authLink + " text-body-sm"}>Forgot password?</Link>
          </div>
        </div>

        {error && <Notice tone="danger">{error}</Notice>}

        <Button type="submit" size="lg" block disabled={loading} loading={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-body-sm text-ink-muted">
        No account? <Link href="/signup" className={authLink}>Create one</Link>
      </p>
    </AuthShell>
  );
}
