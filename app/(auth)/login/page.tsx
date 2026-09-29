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
