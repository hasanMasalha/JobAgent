import Link from "next/link";
import type { ReactNode } from "react";

/** Page frame for legal documents: logo bar, then the document on a card. Used by
 * app/legal/layout.tsx and by /privacy (the Chrome extension's policy, which keeps
 * its own URL because the Web Store listing links to it). */
export function LegalFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="JobAgent" className="block h-10 dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/whiteLogo.png" alt="JobAgent" className="hidden h-10 dark:block" />
          </Link>
          <Link href="/" className="rounded-sm text-body-sm text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            ← Back to Home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <article className="rounded-[1.375rem] bg-surface-raised p-6 shadow-dossier ring-1 ring-line/60 sm:p-10">
          {children}
        </article>
      </main>
    </div>
  );
}

export function LegalHeader({ title, lastUpdated }: { title: string; lastUpdated: string }) {
  return (
    <div className="mb-10">
      <h1 className="font-serif text-title-page text-ink">{title}</h1>
      <p className="mt-2 text-body-sm text-ink-subtle">Last updated: {lastUpdated}</p>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8 last:mb-0">
      <h2 className="mb-3 text-title-section text-ink">{title}</h2>
      <div className="max-w-prose space-y-3 text-body leading-relaxed text-ink-muted">
        {children}
      </div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-inside list-disc space-y-1.5 marker:text-ink-subtle">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export const legalLink = "font-medium text-brand-text underline underline-offset-4";
