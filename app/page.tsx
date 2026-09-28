import Link from "next/link";
import { cn } from "@/lib/cn";
import { SiteHeader } from "@/app/components/SiteHeader";
import { ProductPreview } from "@/app/components/marketing/ProductPreview";
import { PLAN_PRICES_USD, planFeatureList } from "@/lib/plan-limits";
import {
  buttonStyles,
  heroControlStyles,
  PageHero,
  AppWindowIcon,
  CheckIcon,
  CloseIcon,
  ArrowRightIcon,
} from "@/app/components/ui";

// The landing page has one job: make it unmistakable that JobAgent is
// subscription software for job seekers — not a job board, not a résumé-
// writing service, not a recruiting agency. Every claim here is something
// the product does today (see CLAUDE.md "Apply flow rules").

const NOT = [
  {
    title: "Not a job board",
    body: "We don't post jobs or take listings from employers. JobAgent reads public openings from company career sites and job sites and matches them to your CV.",
  },
  {
    title: "Not a recruiting agency",
    body: "Nobody applies on your behalf by hand, and there are no placement fees. You pay for the software, monthly or annually.",
  },
  {
    title: "Not a résumé-writing service",
    body: "CV tailoring is a tool inside the app. It's generated for each application, and you can review it before anything is sent.",
  },
];

const STEPS = [
  {
    title: "Upload your CV",
    body: "Add your CV and tell JobAgent what you're looking for: job titles, locations, remote or on-site.",
  },
  {
    title: "Review your matches",
    body: "Each day, new openings are ranked against your CV, and every match shows why it fits and where you fall short.",
  },
  {
    title: "Apply when you choose",
    body: "On Greenhouse, Lever, Workable, Ashby, Comeet and BambooHR, one click submits your application. Or tailor your CV and cover letter first and review them. LinkedIn roles go through the Chrome extension.",
  },
];

const PLANS = [
  { key: "free", name: "Free" },
  { key: "pro", name: "Pro" },
  { key: "unlimited", name: "Unlimited" },
] as const;

const linkCls =
  "font-semibold text-brand-text underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

export default function Home() {
  const lowestPaidAnnual = Math.min(PLAN_PRICES_USD.pro.annual, PLAN_PRICES_USD.unlimited.annual);

  return (
    <div className="min-h-screen bg-canvas font-sans text-ink">
      <PageHero
        bleed={false}
        className="pb-40 sm:pb-52"
        topBar={<SiteHeader current="home" />}
        tabs={
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-body-sm text-on-hero-muted">
            <AppWindowIcon className="h-3.5 w-3.5" />
            Subscription software for job seekers
          </p>
        }
        title="Your job search, handled by one app"
        subtitle={
          <span className="block max-w-2xl">
            Upload your CV. JobAgent matches you to open roles, tailors your CV and cover letter for each one,
            and submits the application when you click Apply.
          </span>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href="/signup" className={cn(buttonStyles({ variant: "accent", size: "lg" }), "h-12 px-6")}>
            Get Started Free
            <ArrowRightIcon />
          </Link>
          <Link
            href="/pricing"
            className={cn(heroControlStyles({ size: "custom" }), "inline-flex h-12 items-center justify-center px-6 text-body font-semibold")}
          >
            See Pricing
          </Link>
        </div>
        <p className="mt-4 text-body-sm text-on-hero-muted">
          Free plan, no card needed. Paid plans from ${lowestPaidAnnual}/month billed annually. Cancel anytime.
        </p>
      </PageHero>

      <main className="relative mx-auto max-w-6xl px-gutter pb-20 sm:px-gutter-lg sm:pb-28">
        <div className="relative -mt-28 sm:-mt-36 lg:mx-16">
          <ProductPreview />
        </div>

        {/* What it is — and isn't */}
        <section aria-labelledby="what-heading" className="mt-24 sm:mt-32">
          <h2 id="what-heading" className="max-w-3xl text-balance font-serif text-feature-sm text-ink sm:text-feature">
            What you&apos;re signing up for
          </h2>
          <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-8">
            <div className="rounded-[1.375rem] bg-surface-raised p-6 shadow-dossier ring-1 ring-line/60 sm:p-8">
              <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand-text">
                <AppWindowIcon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 font-serif text-[1.625rem] font-medium leading-tight text-ink">An app you use yourself</h3>
              <p className="mt-3 text-body text-ink-muted sm:text-[1.0625rem] sm:leading-7">
                JobAgent is software for individual job seekers. You sign in, review your matches, and decide
                which jobs to apply for. The app does the searching, the tailoring and the form-filling.
              </p>
              <ul className="mt-6 space-y-2.5 border-t border-line pt-6 text-body text-ink">
                {["For people looking for work, not employers or recruiters", "Billed as a monthly or annual subscription", "Nothing is sent without your click"].map((t) => (
                  <li key={t} className="flex gap-3">
                    <CheckIcon className="mt-1 text-success-text" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <ul className="divide-y divide-line rounded-[1.375rem] border border-line bg-surface">
              {NOT.map((item) => (
                <li key={item.title} className="flex gap-4 p-6 sm:p-7">
                  <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
                    <CloseIcon className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <h3 className="text-title-section text-ink">{item.title}</h3>
                    <p className="mt-1.5 text-body text-ink-muted">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-heading" className="mt-24 sm:mt-32">
          <h2 id="how-heading" className="font-serif text-feature-sm text-ink sm:text-feature">How it works</h2>
          <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, i) => (
              <li key={step.title} className="border-t border-line-strong/60 pt-6">
                <span aria-hidden="true" className="numerals font-serif text-[3.25rem] font-medium leading-none text-brand-text">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-title-section text-ink">{step.title}</h3>
                <p className="mt-2 text-body text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Plans */}
        <section aria-labelledby="plans-heading" className="mt-24 sm:mt-32">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="plans-heading" className="font-serif text-feature-sm text-ink sm:text-feature">Plans</h2>
            <Link href="/pricing" className={cn(linkCls, "inline-flex items-center gap-1.5 text-body")}>
              Compare plans and billing
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => (
              <li key={p.key} className="rounded-[1.125rem] border border-line bg-surface p-6">
                <p className="font-serif text-title-serif text-ink">{p.name}</p>
                <p className="mt-3">
                  <span className="numerals font-serif text-[2.25rem] font-medium leading-none text-ink">${PLAN_PRICES_USD[p.key].monthly}</span>
                  <span className="ml-1.5 text-body-sm text-ink-muted">/month</span>
                </p>
                <ul className="mt-4 space-y-1.5 text-body-sm text-ink-muted">
                  {planFeatureList(p.key).slice(0, 2).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      </main>

      {/* Closing call to action */}
      <section className="relative isolate overflow-hidden bg-gradient-to-br from-hero-from via-hero-via to-hero-to px-gutter py-20 text-center text-on-hero sm:px-gutter-lg sm:py-24">
        <h2 className="mx-auto max-w-2xl text-balance font-serif text-feature-sm sm:text-feature">Start with the free plan</h2>
        <p className="mx-auto mt-4 max-w-xl text-body text-on-hero-muted sm:text-[1.0625rem]">
          Upload your CV once and see today&apos;s matches. Upgrade only if you want more.
        </p>
        <Link href="/signup" className={cn(buttonStyles({ variant: "accent", size: "lg" }), "mt-8 h-12 px-6")}>
          Create your free account
        </Link>
      </section>
    </div>
  );
}
