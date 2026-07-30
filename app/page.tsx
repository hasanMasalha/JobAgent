import Link from "next/link";

const NAVY = "#1a2e5e";

const FEATURES = [
  {
    title: "AI-matched jobs",
    body:
      "We scrape Indeed Israel and LinkedIn daily and rank every listing against your CV using vector embeddings — no generic keyword search.",
  },
  {
    title: "Tailored on every apply",
    body:
      "When you click Apply, we tailor your CV and draft a cover letter for that specific job. You review and edit before anything goes out.",
  },
  {
    title: "You always confirm",
    body:
      "Nothing is ever submitted automatically. You approve the tailored application, then we handle LinkedIn Easy Apply for you.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between max-w-6xl mx-auto">
          <Link href="/" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="JobAgent" className="block dark:hidden" style={{ height: 48 }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/whiteLogo.png" alt="JobAgent" className="hidden dark:block" style={{ height: 48 }} />
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/pricing"
              className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/login"
              className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="bg-[#1a2e5e] hover:opacity-90 text-white px-4 py-2 rounded-lg text-sm font-medium transition-opacity"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-12 text-center">
          <h1 className="text-3xl sm:text-5xl font-semibold text-gray-900 dark:text-white leading-tight">
            Your AI job search assistant
          </h1>
          <p className="mt-5 text-base sm:text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
            JobAgent finds and ranks jobs from Indeed Israel and LinkedIn against your CV, tailors your
            application for each one, and applies for you — but only after you say go.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              href="/signup"
              className="bg-[#1a2e5e] hover:opacity-90 text-white px-6 py-3 rounded-lg text-sm font-semibold transition-opacity"
            >
              Get Started Free
            </Link>
            <Link
              href="/pricing"
              className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-6 py-3 rounded-lg text-sm font-semibold border dark:border-gray-700 transition-colors"
            >
              See Pricing
            </Link>
          </div>
        </section>

        {/* Features */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-2xl p-6 sm:p-8"
              >
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{feature.title}</h2>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-20 text-center">
          <div
            className="rounded-2xl p-10 sm:p-14 text-white"
            style={{ background: NAVY }}
          >
            <h2 className="text-2xl sm:text-3xl font-semibold">Stop scrolling job boards</h2>
            <p className="mt-3 text-sm sm:text-base text-white/80 max-w-xl mx-auto">
              Upload your CV once, tell us what you&apos;re looking for, and let JobAgent surface the roles
              worth your time.
            </p>
            <Link
              href="/signup"
              className="inline-block mt-6 bg-white text-[#1a2e5e] px-6 py-3 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Create your free account
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
