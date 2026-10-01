import Link from "next/link";

const linkCls =
  "rounded-sm text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-gutter py-6 sm:flex-row sm:px-gutter-lg">
        <p className="text-caption text-ink-subtle">
          &copy; {new Date().getFullYear()} JobAgent. All rights reserved.
        </p>
        <nav aria-label="Legal" className="flex items-center gap-4 text-caption">
          <Link href="/legal/terms" className={linkCls}>
            Terms of Service
          </Link>
          <Link href="/legal/privacy" className={linkCls}>
            Privacy Policy
          </Link>
          <Link href="/legal/refund" className={linkCls}>
            Refund Policy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
