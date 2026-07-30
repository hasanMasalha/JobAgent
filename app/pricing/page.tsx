"use client";

import { useState } from "react";
import Link from "next/link";

const NAVY = "#1a2e5e";

type Billing = "monthly" | "annual";

interface Tier {
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

const TIERS: Tier[] = [
  {
    name: "Free",
    tagline: "Try it out, no strings attached",
    monthly: 0,
    annual: 0,
    ctaLabel: "Get Started Free",
    ctaHref: "/register",
    features: [
      "10 AI job matches per day",
      "5 auto-applies per month",
      "Basic CV (no tailoring)",
    ],
  },
  {
    name: "Pro",
    tagline: "For active job seekers",
    monthly: 24,
    annual: 19,
    ctaLabel: "Start Pro",
    ctaHref: "/register?plan=pro",
    planKey: "pro",
    features: [
      "100 auto-applies per month",
      "AI CV tailoring per job",
      "All ATS platforms (Greenhouse, Lever, Comeet, Ashby)",
      "Chrome extension access",
    ],
    highlighted: true,
  },
  {
    name: "Unlimited",
    tagline: "For serious career moves",
    monthly: 69,
    annual: 49,
    ctaLabel: "Go Unlimited",
    ctaHref: "/register?plan=unlimited",
    planKey: "unlimited",
    features: [
      "Unlimited auto-applies",
      "Priority matching",
      "Multiple CV versions",
      "Analytics dashboard",
      "Priority support",
    ],
  },
];

function CheckIcon() {
  return (
    <svg
      className="w-5 h-5 shrink-0 text-[#1a2e5e] dark:text-blue-400"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 010 1.415l-7.5 7.5a1 1 0 01-1.415 0l-3.5-3.5a1 1 0 111.415-1.415L8.5 12.086l6.79-6.796a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function savingsPercent(monthly: number, annual: number) {
  if (monthly <= 0) return 0;
  return Math.round((1 - annual / monthly) * 100);
}

export default function PricingPage() {
  const [billing, setBilling] = useState<Billing>("monthly");
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");

  async function handleUpgrade(tier: Tier) {
    if (!tier.planKey) return;
    setCheckoutError("");
    setCheckoutLoading(tier.planKey);
    try {
      const res = await fetch("/api/paddle/checkout", {
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
      if (!res.ok || !data.url) throw new Error(data.error ?? "Failed to start checkout");
      window.location.href = data.url;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setCheckoutLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
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
              href="/login"
              className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="bg-[#1a2e5e] hover:opacity-90 text-white px-4 py-2 rounded-lg text-sm font-medium transition-opacity"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Hero */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h1 className="text-3xl sm:text-4xl font-semibold text-gray-900 dark:text-white">
            Simple, transparent pricing
          </h1>
          <p className="mt-3 text-base text-gray-500 dark:text-gray-400">
            Pick the plan that matches how seriously you&apos;re job hunting. Cancel anytime.
          </p>
        </div>

        {/* Monthly / Annual toggle */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex items-center bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-full p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setBilling("monthly")}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                billing === "monthly"
                  ? "bg-[#1a2e5e] text-white"
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBilling("annual")}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                billing === "annual"
                  ? "bg-[#1a2e5e] text-white"
                  : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              Annual
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  billing === "annual"
                    ? "bg-white/20 text-white"
                    : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                }`}
              >
                Save up to {Math.max(...TIERS.map((t) => savingsPercent(t.monthly, t.annual)))}%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 items-start">
          {TIERS.map((tier) => {
            const price = billing === "monthly" ? tier.monthly : tier.annual;
            const savings = savingsPercent(tier.monthly, tier.annual);

            return (
              <div
                key={tier.name}
                className={`relative rounded-2xl p-6 sm:p-8 flex flex-col h-full ${
                  tier.highlighted
                    ? "bg-blue-50/60 dark:bg-gray-800 border-2 border-[#1a2e5e] dark:border-blue-400 shadow-xl md:scale-105"
                    : "bg-white dark:bg-gray-800 border dark:border-gray-700 shadow-sm"
                }`}
              >
                {tier.highlighted && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-semibold text-white px-3 py-1 rounded-full whitespace-nowrap"
                    style={{ background: NAVY }}
                  >
                    Most Popular
                  </span>
                )}

                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{tier.name}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{tier.tagline}</p>

                <div className="mt-5 flex items-baseline gap-2 flex-wrap">
                  <span className="text-4xl font-bold text-gray-900 dark:text-white">${price}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">/month</span>
                  {billing === "annual" && savings > 0 && (
                    <span className="text-[10px] font-semibold text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-300 px-2 py-0.5 rounded-full">
                      Save {savings}%
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {tier.monthly === 0
                    ? "Free forever"
                    : billing === "annual"
                    ? `Billed annually ($${tier.annual * 12}/year)`
                    : "Billed monthly"}
                </p>

                <ul className="mt-6 space-y-3 flex-1">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                      <CheckIcon />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {tier.planKey ? (
                  <button
                    type="button"
                    disabled={checkoutLoading !== null}
                    onClick={() => handleUpgrade(tier)}
                    className={`mt-8 w-full text-center py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 ${
                      tier.highlighted
                        ? "text-white"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    }`}
                    style={tier.highlighted ? { background: NAVY } : undefined}
                  >
                    {checkoutLoading === tier.planKey ? "Redirecting…" : tier.ctaLabel}
                  </button>
                ) : (
                  <Link
                    href={tier.ctaHref}
                    className={`mt-8 block text-center py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 ${
                      tier.highlighted
                        ? "text-white"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    }`}
                    style={tier.highlighted ? { background: NAVY } : undefined}
                  >
                    {tier.ctaLabel}
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        {checkoutError && (
          <p className="text-center text-sm text-red-600 dark:text-red-400 mt-6">{checkoutError}</p>
        )}
      </main>
    </div>
  );
}
