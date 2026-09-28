"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { SiteHeader } from "@/app/components/SiteHeader";
import { INCLUDED_IN_EVERY_PLAN, PLAN_PRICES_USD, planFeatureList, type PlanKey } from "@/lib/plan-limits";
import {
  Badge,
  Button,
  buttonStyles,
  Notice,
  PageHero,
  CheckIcon,
  AppWindowIcon,
  CalendarIcon,
  SwapIcon,
  DoorOpenIcon,
} from "@/app/components/ui";

type Billing = "monthly" | "annual";

const PLAN_RANK: Record<PlanKey, number> = { free: 0, pro: 1, unlimited: 2 };

interface CurrentPlan {
  plan: PlanKey;
  interval: Billing | null;
}

interface Tier {
  key: PlanKey;
  name: string;
  tagline: string;
  monthly: number;
  annual: number;
  ctaLabel: string;
  ctaHref: string;
  planKey?: "pro" | "unlimited";
  features: string[];
  highlighted?: boolean;
}

// Prices and bullets come from lib/plan-limits.ts, shared with the
// onboarding plan picker and confirmation emails.
const TIERS: Tier[] = [
  {
    key: "free",
    name: "Free",
    tagline: "Try it out, no strings attached",
    ...PLAN_PRICES_USD.free,
    ctaLabel: "Get Started Free",
    ctaHref: "/signup",
    features: planFeatureList("free"),
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "For active job seekers",
    ...PLAN_PRICES_USD.pro,
    ctaLabel: "Start Pro",
    ctaHref: "/signup?plan=pro",
    planKey: "pro",
    features: planFeatureList("pro"),
    highlighted: true,
  },
  {
    key: "unlimited",
    name: "Unlimited",
    tagline: "For serious career moves",
    ...PLAN_PRICES_USD.unlimited,
    ctaLabel: "Go Unlimited",
    ctaHref: "/signup?plan=unlimited",
    planKey: "unlimited",
    features: planFeatureList("unlimited"),
  },
];

function savingsPercent(monthly: number, annual: number) {
  if (monthly <= 0) return 0;
  return Math.round((1 - annual / monthly) * 100);
}

// What a subscriber — and a payment reviewer — needs to know about how
// they're charged. Plan-change timing mirrors /api/dodo/checkout
// (subscriptions.changePlan with prorated_immediately).
const refundLink =
  "font-semibold text-brand-text underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";
const BILLING_FACTS = [
  {
    Icon: AppWindowIcon,
    title: "A software subscription",
    body: "JobAgent is subscription software for job seekers. Your plan pays for access to the app and its monthly limits — not per application, and not for a recruiting or placement service.",
  },
  {
    Icon: CalendarIcon,
    title: "Monthly or annual",
    body: "Pay monthly, or annually at a lower monthly price. Prices are in US dollars.",
  },
  {
    Icon: SwapIcon,
    title: "Change plans any time",
    body: "Upgrades, and moving to annual billing, take effect straight away with a prorated charge. Downgrades, and moving to monthly, apply from your next billing date.",
  },
  {
    Icon: DoorOpenIcon,
    title: "Cancel anytime",
    body: (
      <>
        No contract, and the Free plan needs no payment details. Refunds are covered by our{" "}
        <Link href="/legal/refund" className={refundLink}>Refund Policy</Link>.
      </>
    ),
  },
];

export default function PricingPage() {
  const [billing, setBilling] = useState<Billing>("monthly");
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState("");
  // null = not loaded yet, or logged out — buttons then behave as for a new customer.
  const [current, setCurrent] = useState<CurrentPlan | null>(null);

  useEffect(() => {
    fetch("/api/plan")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CurrentPlan | null) => {
        if (d?.plan) setCurrent(d);
      })
      .catch(() => {});
  }, []);

  // What the button for `tier` should do given the user's current plan.
  function ctaFor(tier: Tier): { label: string; disabled: boolean } {
    const key = tier.planKey;
    if (!key || !current || current.plan === "free") return { label: tier.ctaLabel, disabled: false };
    if (key === current.plan) {
      if (current.interval === null || current.interval === billing) return { label: "Current plan", disabled: true };
      return { label: billing === "annual" ? "Switch to annual" : "Switch to monthly", disabled: false };
    }
    return PLAN_RANK[key] > PLAN_RANK[current.plan]
      ? { label: "Upgrade", disabled: false }
      : { label: "Downgrade", disabled: false };
  }

  async function handleUpgrade(tier: Tier) {
    if (!tier.planKey) return;
    setCheckoutError("");
    setCheckoutNotice("");
    setCheckoutLoading(tier.planKey);
    try {
      const res = await fetch("/api/dodo/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: tier.planKey, interval: billing }),
      });

      if (res.status === 401) {
        // Not signed in — send them through registration instead of a raw checkout error.
        window.location.href = tier.ctaHref;
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to start checkout");

      if (data.changed) {
        // Existing subscriber: the subscription was changed in place, no checkout.
        setCheckoutNotice(
          data.effective === "immediately"
            ? "Your plan is being updated — this can take a moment to show."
            : "Your plan will change at the start of your next billing period."
        );
        return;
      }
      if (!data.checkoutUrl) throw new Error("Failed to start checkout");

      window.location.href = data.checkoutUrl;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setCheckoutLoading(null);
    }
  }

  const maxSavings = Math.max(...TIERS.map((t) => savingsPercent(t.monthly, t.annual)));

  return (
    <div className="min-h-screen bg-canvas font-sans text-ink">
      <PageHero
        bleed={false}
        topBar={<SiteHeader current="pricing" />}
        title="Simple, transparent pricing"
        subtitle={<>Pick the plan that matches how seriously you&apos;re job hunting. Cancel anytime.</>}
      >
        <div role="group" aria-label="Billing period" className="inline-flex rounded-full border border-white/10 bg-white/[0.06] p-1">
          {(["monthly", "annual"] as const).map((b) => {
            const on = billing === b;
            return (
              <button
                key={b}
                type="button"
                aria-pressed={on}
                onClick={() => setBilling(b)}
                className={cn(
                  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
                  on ? "bg-on-hero font-semibold text-hero-from" : "text-on-hero-muted hover:text-on-hero",
                )}
              >
                {b === "monthly" ? "Monthly" : "Annual"}
                {b === "annual" && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold",
                      on ? "bg-success-soft text-success-text" : "bg-white/10 text-on-hero",
                    )}
                  >
                    Save up to {maxSavings}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </PageHero>

      <main className="relative mx-auto -mt-14 max-w-6xl px-gutter pb-20 sm:-mt-16 sm:px-gutter-lg sm:pb-28">
        <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-3 lg:gap-6">
          {TIERS.map((tier) => {
            const price = billing === "monthly" ? tier.monthly : tier.annual;
            const savings = savingsPercent(tier.monthly, tier.annual);
            const cta = ctaFor(tier);
            const featured = tier.highlighted;

            return (
              <section
                key={tier.name}
                aria-labelledby={`tier-${tier.name}`}
                className={cn(
                  "relative flex flex-col rounded-[1.375rem] p-6 motion-safe:animate-lift-in sm:p-8",
                  featured
                    ? "bg-surface-raised shadow-dossier ring-1 ring-accent/50 md:-mt-4 md:pb-12"
                    : "border border-line bg-surface md:mt-4",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 id={`tier-${tier.name}`} className="font-serif text-[1.625rem] font-medium leading-tight text-ink">
                    {tier.name}
                  </h2>
                  {featured && <Badge tone="accent">Most Popular</Badge>}
                </div>
                <p className="mt-1.5 text-body-sm text-ink-muted">{tier.tagline}</p>

                <div className="mt-7 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="numerals font-serif text-[3.5rem] font-medium leading-none tracking-tight text-ink">${price}</span>
                  <span className="text-body-sm text-ink-muted">/month</span>
                  {billing === "annual" && savings > 0 && <Badge tone="success">Save {savings}%</Badge>}
                </div>
                <p className="mt-2 text-caption text-ink-subtle">
                  {tier.monthly === 0
                    ? "Free forever"
                    : billing === "annual"
                    ? `Billed annually ($${tier.annual * 12}/year)`
                    : "Billed monthly"}
                </p>

                <ul className="mt-7 flex-1 space-y-3 border-t border-line pt-7">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-body-sm text-ink sm:text-[0.9375rem] sm:leading-6">
                      <CheckIcon className="mt-0.5 h-[1.125rem] w-[1.125rem] text-brand-text" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {tier.planKey ? (
                  <Button
                    variant={cta.disabled && cta.label === "Current plan" ? "current" : featured ? "accent" : "secondary"}
                    size="lg"
                    block
                    className="mt-8"
                    disabled={checkoutLoading !== null || cta.disabled}
                    loading={checkoutLoading === tier.planKey}
                    onClick={() => handleUpgrade(tier)}
                  >
                    {checkoutLoading === tier.planKey ? "Working…" : cta.label}
                  </Button>
                ) : (
                  <Link href={tier.ctaHref} className={cn(buttonStyles({ variant: "secondary", size: "lg", block: true }), "mt-8")}>
                    {tier.ctaLabel}
                  </Link>
                )}
              </section>
            );
          })}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-body-sm text-ink-muted">{INCLUDED_IN_EVERY_PLAN}</p>

        {(checkoutNotice || checkoutError) && (
          <div className="mx-auto mt-8 max-w-xl">
            {checkoutNotice && <Notice tone="success">{checkoutNotice}</Notice>}
            {checkoutError && <Notice tone="danger">{checkoutError}</Notice>}
          </div>
        )}

        <section aria-labelledby="billing-heading" className="mt-20 sm:mt-28">
          <h2 id="billing-heading" className="font-serif text-feature-sm text-ink sm:text-feature">How billing works</h2>
          <dl className="mt-8 grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {BILLING_FACTS.map(({ Icon, title, body }) => (
              <div key={title} className="flex gap-4">
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text">
                  <Icon />
                </span>
                <div>
                  <dt className="text-title-card text-ink">{title}</dt>
                  <dd className="mt-1.5 text-body text-ink-muted">{body}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}
