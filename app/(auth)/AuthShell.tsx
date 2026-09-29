import Link from "next/link";
import { cn } from "@/lib/cn";

// Shared frame for /login and /signup: a navy brand panel beside the form on
// desktop, the form alone under the logo on phones.

// Same claims as the onboarding welcome — nothing the product doesn't do.
const BULLETS = [
  "Matches you to open roles worldwide, ranked against your CV",
  "Applies to Greenhouse, Lever, Workable, Ashby, Comeet and BambooHR in one click",
  "Tailors your CV and cover letter for each application",
];

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-hero-from via-hero-via to-hero-to p-12 text-on-hero md:flex">
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMaxYMin slice" viewBox="0 0 640 900" fill="none">
          <g stroke="white" strokeOpacity="0.05">
            {[1, 2, 3, 4, 5, 6].map((i) => <ellipse key={i} cx="560" cy="60" rx={60 + i * 80} ry={40 + i * 64} />)}
          </g>
        </svg>

        <Link href="/" className="relative w-fit rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/whiteLogo.png" alt="JobAgent" className="w-44" />
        </Link>

        <div className="relative">
          <p className="max-w-md text-balance font-serif text-feature leading-tight">Find your next role, faster.</p>
          <ul className="mt-10 max-w-md space-y-4">
            {BULLETS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-body text-on-hero">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-caption text-on-hero-muted">© 2026 JobAgent. All rights reserved.</p>
      </aside>

      <main className="flex w-full flex-col items-center justify-center px-4 py-10 md:w-1/2 md:px-8">
        <Link href="/" className="mb-8 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="JobAgent" className="w-44" />
        </Link>
        <div className="w-full max-w-sm rounded-[1.375rem] bg-surface-raised p-6 shadow-dossier ring-1 ring-line/60 sm:p-8 md:bg-transparent md:p-0 md:shadow-none md:ring-0">
          <h1 className="font-serif text-title-page-sm text-ink">{title}</h1>
          <p className="mt-1.5 text-body-sm text-ink-muted">{subtitle}</p>
          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function GoogleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 w-full items-center justify-center gap-2.5 rounded-control border border-line-strong bg-surface text-body font-semibold text-ink transition-colors",
        "hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
      )}
    >
      {/* Google's mark in its own colours, per Google's branding rules. */}
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
      Continue with Google
    </button>
  );
}

export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3" aria-hidden="true">
      <div className="h-px flex-1 bg-line" />
      <span className="text-caption text-ink-subtle">or</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

export const authLink = "font-semibold text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";
