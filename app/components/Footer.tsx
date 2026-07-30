import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          &copy; {new Date().getFullYear()} JobAgent. All rights reserved.
        </p>
        <nav className="flex items-center gap-4 text-xs">
          <Link
            href="/legal/terms"
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Terms of Service
          </Link>
          <Link
            href="/legal/privacy"
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Privacy Policy
          </Link>
          <Link
            href="/legal/refund"
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Refund Policy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
