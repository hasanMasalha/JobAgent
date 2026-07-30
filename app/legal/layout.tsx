import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between max-w-4xl mx-auto">
          <Link href="/" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="JobAgent" className="block dark:hidden" style={{ height: 40 }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/whiteLogo.png" alt="JobAgent" className="hidden dark:block" style={{ height: 40 }} />
          </Link>
          <Link
            href="/"
            className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            ← Back to Home
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-2xl p-6 sm:p-10">
          {children}
        </div>
      </main>
    </div>
  );
}
