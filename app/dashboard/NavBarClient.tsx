"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import LogoutButton from "./LogoutButton";
import { ThemeToggle } from "@/app/components/ThemeToggle";

const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? ""

function ExtensionBadge() {
  const [installed, setInstalled] = useState<boolean | null>(null)
  useEffect(() => {
    if (!EXTENSION_ID || typeof chrome === "undefined" || !chrome?.runtime?.sendMessage) {
      setInstalled(false)
      return
    }
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type: "PING" }, () => {
        setInstalled(!chrome.runtime.lastError)
      })
    } catch {
      setInstalled(false)
    }
  }, [])

  if (installed === null) return null
  if (installed) {
    return (
      <span className="hidden lg:inline-flex items-center gap-1.5 text-caption font-medium text-success-text">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
        Extension active
      </span>
    )
  }
  return (
    <a
      href="https://chromewebstore.google.com/detail/jobagent-%E2%80%94-ai-job-assista/cjcfjidmlmclbemjoobdipjlcdbkldda"
      target="_blank"
      rel="noopener noreferrer"
      className="hidden lg:inline text-caption font-medium text-brand-text hover:underline underline-offset-2"
    >
      Get the extension
    </a>
  )
}

const NAV_LINKS = [
  { href: "/dashboard", label: "Home" },
  { href: "/dashboard/matches", label: "My Matches" },
  { href: "/dashboard/applications", label: "Applications" },
  { href: "/dashboard/saved", label: "Saved" },
  { href: "/dashboard/my-cv", label: "My CV" },
  { href: "/dashboard/profile", label: "Profile" },
  { href: "/pricing", label: "Pricing" },
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
}

export default function NavBarClient({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";
  const username = userEmail.split("@")[0];

  return (
    <nav aria-label="Main" className="border-b border-line bg-surface">
      <div className="flex h-16 items-center justify-between gap-4 px-gutter sm:px-gutter-lg">
        <div className="flex min-w-0 items-center gap-6 self-stretch">
          <Link href="/dashboard" className="shrink-0 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="JobAgent" className="block h-10 w-auto dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/whiteLogo.png" alt="JobAgent" className="hidden h-10 w-auto dark:block" />
          </Link>
          <div className="hidden items-stretch gap-1 self-stretch md:flex">
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    "after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full",
                    active
                      ? "font-semibold text-ink after:bg-brand"
                      : "text-ink-muted hover:text-ink after:bg-transparent",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ExtensionBadge />
          <span className="hidden max-w-[12rem] truncate text-body-sm text-ink-subtle lg:inline" title={userEmail}>
            {username}
          </span>
          <ThemeToggle />
          <LogoutButton />
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="flex h-9 w-9 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          >
            {open ? (
              <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg aria-hidden="true" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {open && (
        <div id="mobile-nav" className="space-y-0.5 border-t border-line px-gutter py-3 md:hidden">
          <p className="mb-2 truncate text-caption text-ink-subtle">{username}</p>
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-control px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-brand-soft font-semibold text-brand-text" : "text-ink hover:bg-surface-sunken",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
