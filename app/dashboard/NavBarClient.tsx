"use client";

import { useState } from "react";
import Link from "next/link";
import LogoutButton from "./LogoutButton";
import { ThemeToggle } from "@/app/components/ThemeToggle";

const NAV_LINKS = [
  { href: "/dashboard", label: "Jobs" },
  { href: "/dashboard/applications", label: "Applications" },
  { href: "/dashboard/saved", label: "Saved" },
  { href: "/dashboard/my-cv", label: "My CV" },
  { href: "/dashboard/profile", label: "Profile" },
];

export default function NavBarClient({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);
  const username = userEmail.split("@")[0];

  return (
    <nav className="bg-white dark:bg-gray-800 border-b dark:border-gray-700">
      <div className="px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4 sm:gap-6">
          <span className="font-semibold text-sm dark:text-white">JobAgent</span>
          <div className="hidden sm:flex items-center gap-4 text-sm">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-sm text-gray-500 dark:text-gray-400">
            {username}
          </span>
          <ThemeToggle />
          <LogoutButton />
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            className="sm:hidden p-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {open ? (
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {open && (
        <div className="sm:hidden border-t dark:border-gray-700 px-4 py-3 space-y-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{username}</p>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
