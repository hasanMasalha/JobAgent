import Link from "next/link";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "@/app/components/ThemeToggle";

/**
 * Header for public pages (landing, pricing). Sits on the navy PageHero band
 * via its topBar slot, so it uses the white logo and on-hero colours in both
 * themes.
 */
export function SiteHeader({ current }: { current?: "home" | "pricing" }) {
  const link = (active: boolean) =>
    cn(
      "rounded-control px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
      active ? "font-semibold text-on-hero" : "text-on-hero-muted hover:text-on-hero",
    );

  return (
    <header className="border-b border-white/[0.08]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-gutter sm:h-[4.5rem] sm:px-gutter-lg">
        <Link href="/" aria-current={current === "home" ? "page" : undefined} className="shrink-0 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/whiteLogo.png" alt="JobAgent" className="block h-8 w-auto sm:h-10" />
        </Link>
        <nav aria-label="Site" className="flex items-center gap-1 sm:gap-3">
          <Link href="/pricing" aria-current={current === "pricing" ? "page" : undefined} className={cn(link(current === "pricing"), "hidden sm:inline-flex")}>
            Pricing
          </Link>
          <Link href="/login" className={link(false)}>
            Log in
          </Link>
          <ThemeToggle onHero />
          <Link
            href="/signup"
            className="ml-1 inline-flex h-9 items-center rounded-control bg-on-hero px-3.5 text-sm font-semibold text-hero-from transition-colors hover:bg-on-hero/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:h-10 sm:px-4"
          >
            Get Started
          </Link>
        </nav>
      </div>
    </header>
  );
}
