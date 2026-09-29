"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { JOB_CATEGORIES, SENIORITY_LEVELS, CATEGORY_KEYWORDS } from "@/lib/job-categories";
import { INCLUDED_IN_EVERY_PLAN, PLAN_PRICES_USD, planFeatureList } from "@/lib/plan-limits";
import { cn } from "@/lib/cn";
import {
  Badge,
  Button,
  chipStyles,
  inputStyles,
  Notice,
  PageHero,
  RemovableTag,
  Spinner,
  ArrowRightIcon,
  CheckIcon,
  DocumentIcon,
  PenIcon,
  UploadIcon,
} from "@/app/components/ui";

interface ExistingCV {
  clean_summary: string;
  skills_json: { skills?: string[]; years_experience?: number } | null;
  updated_at: string;
}

interface Profile {
  cv?: ExistingCV;
  preferences?: {
    titles?: string[];
    locations?: string[];
    remote_ok?: boolean;
    work_modes?: string[];
    min_salary?: number;
  };
}

interface PlanTier {
  key: string;
  name: string;
  price: string;
  features: string[];
  ctaLabel: string;
  destination: string;
  highlighted?: boolean;
}

// Prices and bullets come from lib/plan-limits.ts, shared with /pricing and
// confirmation emails, so the picker can't promise something pricing doesn't.
const PLAN_TIERS: PlanTier[] = [
  {
    key: "free",
    name: "Free",
    price: `$${PLAN_PRICES_USD.free.monthly}`,
    features: planFeatureList("free"),
    ctaLabel: "Start Free",
    destination: "/dashboard",
  },
  {
    key: "pro",
    name: "Pro",
    price: `$${PLAN_PRICES_USD.pro.monthly}`,
    features: planFeatureList("pro"),
    ctaLabel: "Upgrade to Pro",
    destination: "/pricing",
    highlighted: true,
  },
  {
    key: "unlimited",
    name: "Unlimited",
    price: `$${PLAN_PRICES_USD.unlimited.monthly}`,
    features: planFeatureList("unlimited"),
    ctaLabel: "Go Unlimited",
    destination: "/pricing",
  },
];

// Matches the landing page's claims: nothing is sent without the user's click.
const WELCOME_BULLETS = [
  "Matches you to open roles worldwide, ranked against your CV",
  "Applies to Greenhouse, Lever, Workable, Ashby, Comeet and BambooHR in one click",
  "Tailors your CV and cover letter for each application",
];

const COUNTRIES = [
  "United States", "United Kingdom", "Canada", "Australia", "Germany",
  "France", "Netherlands", "Israel", "Singapore", "UAE", "India",
  "Sweden", "Switzerland", "Denmark", "Norway", "Finland", "Spain",
  "Italy", "Poland", "Portugal", "Remote",
];

const WORK_ARRANGEMENTS = ["Remote", "Hybrid", "On-site", "Open to all"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isUpdate, setIsUpdate] = useState(false);
  const [existingCV, setExistingCV] = useState<ExistingCV | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // CV step — path choice
  const [cvPath, setCvPath] = useState<"upload" | null>(null);
  const [file, setFile] = useState<File | null>(null);

  // Preferences step
  const [titleInput, setTitleInput] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [minSalary, setMinSalary] = useState("");
  const [skipSalary, setSkipSalary] = useState(false);

  // Categories step
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Seniority + work arrangement step
  const [selectedSeniorities, setSelectedSeniorities] = useState<string[]>([]);
  const [selectedWorkArrangements, setSelectedWorkArrangements] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Plan step
  const [planActionLoading, setPlanActionLoading] = useState<string | null>(null);
  const [planError, setPlanError] = useState("");
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/plan")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { plan?: string } | null) => {
        if (d?.plan) setCurrentPlan(d.plan);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d: Profile) => {
        if (d.cv) {
          setIsUpdate(true);
          setExistingCV(d.cv);
        }
        if (d.preferences) {
          const prefs = d.preferences;
          if (prefs.titles?.length) setTitles(prefs.titles);
          if (prefs.locations?.[0]) {
            setLocation(prefs.locations[0]);
            setLocationQuery(prefs.locations[0]);
          }
          if (prefs.work_modes?.length) {
            setSelectedWorkArrangements(prefs.work_modes);
          } else if (prefs.remote_ok) {
            setSelectedWorkArrangements(["Remote"]);
          }
          if (prefs.min_salary) setMinSalary(String(prefs.min_salary));
          else setSkipSalary(true);
        }
      })
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, []);

  function addTitle() {
    const t = titleInput.trim();
    if (t && !titles.includes(t)) setTitles([...titles, t]);
    setTitleInput("");
  }

  function removeTitle(t: string) {
    setTitles(titles.filter((x) => x !== t));
  }

  function toggleCategory(cat: string) {
    if (selectedCategories.includes(cat)) {
      setSelectedCategories((prev) => prev.filter((c) => c !== cat));
    } else if (selectedCategories.length < 4) {
      setSelectedCategories((prev) => [...prev, cat]);
    }
  }

  function toggleSeniority(val: string) {
    setSelectedSeniorities((prev) =>
      prev.includes(val) ? prev.filter((s) => s !== val) : [...prev, val]
    );
  }

  function toggleWorkArrangement(val: string) {
    setSelectedWorkArrangements((prev) =>
      prev.includes(val) ? prev.filter((l) => l !== val) : [...prev, val]
    );
  }

  const filteredCountries = COUNTRIES.filter((c) =>
    c.toLowerCase().includes(locationQuery.toLowerCase())
  );

  // "Open to all" isn't a real work mode — it means no restriction, i.e. all three.
  const resolvedWorkModes = selectedWorkArrangements.includes("Open to all")
    ? ["Remote", "Hybrid", "On-site"]
    : selectedWorkArrangements;

  // Fresh onboarding gets the full Welcome → CV → Preferences → Categories → Seniority → Plan flow.
  // Returning users editing an existing profile keep the original 4-step flow untouched.
  const stepKeys = isUpdate
    ? ["cv", "preferences", "categories", "seniority"]
    : ["welcome", "cv", "preferences", "categories", "seniority", "plan"];
  const TOTAL_STEPS = stepKeys.length;
  const currentKey = stepKeys[step - 1];

  function goNext() {
    setStep((s) => Math.min(s + 1, stepKeys.length));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 1));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (file) {
        const form = new FormData();
        form.append("cv", file);
        form.append("titles", JSON.stringify(titles));
        form.append("location", location);
        form.append("remote_ok", String(resolvedWorkModes.includes("Remote")));
        form.append("work_modes", JSON.stringify(resolvedWorkModes));
        form.append("min_salary", skipSalary ? "" : minSalary);

        console.log("[onboarding] uploading CV...");
        const res = await fetch("/api/cv/upload", { method: "POST", body: form });
        console.log("[onboarding] response status:", res.status);

        const text = await res.text();
        console.log("[onboarding] response text:", text.substring(0, 200));

        let data: { success?: boolean; processing?: boolean; error?: string };
        try {
          data = JSON.parse(text);
        } catch {
          console.error("[onboarding] non-JSON from /api/cv/upload:", text.substring(0, 300));
          setError("Something went wrong. Please try again.");
          return;
        }

        if (!res.ok) throw new Error(data.error ?? "Upload failed");
      } else {
        const payload = {
          titles,
          locations: location ? [location] : [],
          remote_ok: resolvedWorkModes.includes("Remote"),
          work_modes: resolvedWorkModes,
          min_salary: skipSalary ? null : (minSalary ? parseInt(minSalary) : null),
        };
        console.log("[onboarding] saving preferences:", payload);

        const res = await fetch("/api/profile/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        console.log("[onboarding] response status:", res.status);

        const text = await res.text();
        console.log("[onboarding] response text:", text.substring(0, 200));

        let data: { success?: boolean; error?: string };
        try {
          data = JSON.parse(text);
        } catch {
          console.error("[onboarding] non-JSON from /api/profile/preferences:", text.substring(0, 300));
          setError("Something went wrong. Please try again.");
          return;
        }

        if (!res.ok) throw new Error(data.error ?? "Update failed");
      }

      // Save saved searches for each selected category
      if (selectedCategories.length > 0) {
        await Promise.all(
          selectedCategories.map((category) =>
            fetch("/api/saved-searches", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                category,
                keywords: CATEGORY_KEYWORDS[category] ?? [],
                // Work arrangement (Remote/Hybrid/On-site) isn't the geographic
                // taxonomy this endpoint's location filter expects — omit it
                // rather than filtering job results against the wrong values.
                locations: [],
                seniorities: selectedSeniorities,
              }),
            })
          )
        );
      }

      if (isUpdate) {
        router.push("/dashboard");
      } else {
        // Fresh onboarding continues to the plan-selection step instead of the dashboard.
        goNext();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handlePlanChoice(tier: PlanTier) {
    setPlanError("");
    setPlanActionLoading(tier.key);
    try {
      const completeRes = await fetch("/api/onboarding/complete", { method: "POST" });
      if (!completeRes.ok) throw new Error("Failed to complete onboarding");

      if (tier.key === "pro" || tier.key === "unlimited") {
        const checkoutRes = await fetch("/api/dodo/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: tier.key, interval: "monthly" }),
        });
        const data = await checkoutRes.json().catch(() => ({}));
        if (!checkoutRes.ok) throw new Error(data.error ?? "Failed to start checkout");

        if (data.changed) {
          // Existing subscriber: plan was changed in place, no checkout needed.
          router.push("/dashboard");
          return;
        }
        if (!data.checkoutUrl) throw new Error("Failed to start checkout");

        window.location.href = data.checkoutUrl;
        return;
      }

      router.push(tier.destination);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setPlanActionLoading(null);
    }
  }

  if (profileLoading) {
    return (
      <div className="flex justify-center pt-24 text-ink-subtle">
        <Spinner size="lg" label="Loading your profile" />
      </div>
    );
  }

  const heroTitle =
    currentKey === "welcome" ? "Let's set up your job search" : isUpdate ? "Update your profile" : "Set up your profile";
  const cardCls =
    "rounded-[1.375rem] bg-surface-raised p-5 shadow-dossier ring-1 ring-line/60 motion-safe:animate-lift-in sm:p-10";
  const stepHeading = "font-serif text-feature-sm text-ink";
  const backLink =
    "inline-flex items-center gap-1 rounded-sm text-body-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const actions = "mt-8 flex flex-col-reverse gap-3 sm:flex-row";

  return (
    <div className="w-full">
      <PageHero
        title={heroTitle}
        subtitle={currentKey === "welcome" ? "A few questions, then your first matches." : undefined}
        meta={<span className="text-body-sm text-on-hero-muted">Step {step} of {TOTAL_STEPS}</span>}
      >
        <div className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
            <div
              key={s}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-500 ease-calm",
                s <= step ? "bg-on-hero" : "bg-white/15",
              )}
            />
          ))}
        </div>
      </PageHero>

      <div className={cn("relative mx-auto -mt-14 sm:-mt-16", currentKey === "plan" ? "max-w-6xl" : "max-w-2xl")}>
        {/* ── Welcome ── */}
        {currentKey === "welcome" && (
          <section aria-labelledby="welcome-heading" className={cardCls}>
            <h2 id="welcome-heading" className={stepHeading}>What JobAgent does for you</h2>
            <ul className="mt-6 space-y-4">
              {WELCOME_BULLETS.map((item) => (
                <li key={item} className="flex items-start gap-3.5 text-body text-ink sm:text-[1.0625rem] sm:leading-7">
                  <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text">
                    <CheckIcon className="h-3.5 w-3.5" />
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Button size="lg" block className="mt-9" onClick={goNext}>
              Get Started
              <ArrowRightIcon />
            </Button>
          </section>
        )}

        {/* ── CV ── */}
        {currentKey === "cv" && (
          <section aria-labelledby="cv-heading" className={cardCls}>
            {!isUpdate && (
              <button type="button" onClick={goBack} className={cn(backLink, "mb-5")}>
                ← Back
              </button>
            )}
            <h2 id="cv-heading" className={stepHeading}>Your CV</h2>
            {!isUpdate && (
              <p className="mt-2 text-body text-ink-muted">Upload your CV to get personalized matches</p>
            )}

            {isUpdate && existingCV && (
              <div className="mt-6 rounded-card border border-line bg-surface-sunken p-4">
                <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">Current CV</p>
                {existingCV.skills_json?.skills?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {existingCV.skills_json.skills.slice(0, 12).map((s) => (
                      <Badge key={s} tone="neutral">{s}</Badge>
                    ))}
                    {existingCV.skills_json.skills.length > 12 && (
                      <span className="self-center text-caption text-ink-subtle">+{existingCV.skills_json.skills.length - 12} more</span>
                    )}
                  </div>
                ) : null}
                <p className="mt-3 text-body-sm text-ink-muted">
                  {existingCV.skills_json?.years_experience != null && (
                    <>
                      {existingCV.skills_json.years_experience} year{existingCV.skills_json.years_experience === 1 ? "" : "s"} experience ·{" "}
                    </>
                  )}
                  Last updated {new Date(existingCV.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
            )}

            {cvPath === null && (
              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setCvPath("upload")}
                  className="group flex flex-col items-start gap-4 rounded-card border border-line bg-surface p-5 text-left transition-all duration-300 ease-calm hover:border-brand/60 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:hover:-translate-y-0.5"
                >
                  <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand-text transition-colors group-hover:bg-brand group-hover:text-brand-on">
                    <UploadIcon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-title-card text-ink">{isUpdate ? "Replace CV" : "Upload existing CV"}</span>
                    <span className="mt-1 block text-body-sm text-ink-muted">PDF or Word document (.pdf, .docx)</span>
                  </span>
                  <span className="mt-auto text-body-sm font-semibold text-brand-text">{isUpdate ? "Upload new CV" : "Upload CV"} →</span>
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/dashboard/cv-builder")}
                  className="group flex flex-col items-start gap-4 rounded-card border border-line bg-surface p-5 text-left transition-all duration-300 ease-calm hover:border-brand/60 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:hover:-translate-y-0.5"
                >
                  <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand-text transition-colors group-hover:bg-brand group-hover:text-brand-on">
                    <PenIcon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block text-title-card text-ink">Build CV with AI</span>
                    <span className="mt-1 block text-body-sm text-ink-muted">Answer a few questions, Claude writes it</span>
                  </span>
                  <span className="mt-auto text-body-sm font-semibold text-brand-text">Start building →</span>
                </button>
              </div>
            )}

            {cvPath === "upload" && (
              <div className="mt-6">
                <button type="button" onClick={() => setCvPath(null)} className={backLink}>
                  ← Back to options
                </button>
                <label
                  className={cn(
                    "mt-4 flex cursor-pointer flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors",
                    "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                    file ? "border-brand/50 bg-brand-soft/40" : "border-line-strong/60 hover:border-brand/60 hover:bg-surface-sunken",
                  )}
                >
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f && f.size > 5 * 1024 * 1024) { setError("File must be under 5MB"); return; }
                      setError("");
                      setFile(f ?? null);
                    }}
                  />
                  <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-brand-text ring-1 ring-line">
                    {file ? <DocumentIcon className="h-5 w-5" /> : <UploadIcon className="h-5 w-5" />}
                  </span>
                  {file ? (
                    <span className="text-body font-semibold text-ink">{file.name}</span>
                  ) : (
                    <span className="text-body text-ink-muted">
                      {isUpdate ? "Click to choose a new PDF or Word file (optional)" : "Click to choose a PDF or Word file (.docx)"}
                    </span>
                  )}
                </label>
                {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
                <Button size="lg" block className="mt-6" disabled={!isUpdate && !file} onClick={goNext}>
                  Continue
                </Button>
              </div>
            )}

            {isUpdate && cvPath === null && (
              <div className="mt-6 text-center">
                <button type="button" onClick={goNext} className={backLink}>
                  Keep current CV, update preferences only →
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── Preferences ── */}
        {currentKey === "preferences" && (
          <section aria-labelledby="prefs-heading" className={cardCls}>
            <h2 id="prefs-heading" className={stepHeading}>What you&apos;re looking for</h2>
            <div className="mt-7 space-y-6">
              {/* Job titles */}
              <div>
                <label htmlFor="onb-title" className="block text-body-sm font-medium text-ink">Job titles you&apos;re looking for</label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="onb-title"
                    type="text"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTitle(); } }}
                    placeholder="e.g. Frontend Developer"
                    className={cn(inputStyles(), "h-11 flex-1")}
                  />
                  <Button variant="secondary" size="lg" onClick={addTitle}>
                    Add
                  </Button>
                </div>
                {titles.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {titles.map((t) => (
                      <RemovableTag key={t} label={t} onRemove={() => removeTitle(t)} />
                    ))}
                  </div>
                )}
              </div>

              {/* Location */}
              <div className="relative">
                <label htmlFor="onb-location" className="block text-body-sm font-medium text-ink">Location</label>
                <input
                  id="onb-location"
                  type="text"
                  value={locationQuery}
                  onChange={(e) => {
                    setLocationQuery(e.target.value);
                    setLocation("");
                    setLocationDropdownOpen(true);
                  }}
                  onFocus={() => setLocationDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setLocationDropdownOpen(false), 150)}
                  placeholder="Search for a country…"
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={locationDropdownOpen && filteredCountries.length > 0}
                  aria-controls="onb-location-list"
                  className={cn(inputStyles(), "mt-1.5 h-11 w-full")}
                />
                {locationDropdownOpen && filteredCountries.length > 0 && (
                  <ul
                    id="onb-location-list"
                    role="listbox"
                    className="absolute z-10 mt-1.5 max-h-56 w-full overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-overlay"
                  >
                    {filteredCountries.map((c) => (
                      <li key={c} role="option" aria-selected={location === c}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setLocation(c);
                            setLocationQuery(c);
                            setLocationDropdownOpen(false);
                          }}
                          className={cn(
                            "w-full px-3.5 py-2 text-left text-body-sm transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none",
                            location === c ? "bg-brand-soft font-semibold text-brand-text" : "text-ink",
                          )}
                        >
                          {c}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Min salary */}
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="onb-salary" className="text-body-sm font-medium text-ink">Minimum salary</label>
                  <button
                    type="button"
                    onClick={() => { setSkipSalary((v) => !v); setMinSalary(""); }}
                    className="rounded-sm text-body-sm font-medium text-brand-text underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {skipSalary ? "Add salary" : "Skip salary"}
                  </button>
                </div>
                {!skipSalary && (
                  <input
                    id="onb-salary"
                    type="number"
                    value={minSalary}
                    onChange={(e) => setMinSalary(e.target.value)}
                    placeholder="e.g. 15000"
                    className={cn(inputStyles(), "mt-1.5 h-11 w-full")}
                  />
                )}
                {skipSalary && <p className="mt-1.5 text-body-sm italic text-ink-subtle">No minimum salary set</p>}
              </div>
            </div>

            <div className={actions}>
              <Button variant="secondary" size="lg" className="sm:flex-1" onClick={goBack}>
                Back
              </Button>
              <Button size="lg" className="sm:flex-1" disabled={titles.length === 0} onClick={goNext}>
                Continue
              </Button>
            </div>
          </section>
        )}

        {/* ── Categories ── */}
        {currentKey === "categories" && (
          <section aria-labelledby="cat-heading" className={cardCls}>
            <h2 id="cat-heading" className={stepHeading}>What job are you looking for?</h2>
            <p className="mt-2 text-body text-ink-muted">
              Pick up to 4 categories
              <span className="ml-2 font-semibold text-ink" aria-live="polite">{selectedCategories.length}/4 selected</span>
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {JOB_CATEGORIES.map((cat) => {
                const isSelected = selectedCategories.includes(cat);
                const isDisabled = !isSelected && selectedCategories.length >= 4;
                return (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggleCategory(cat)}
                    disabled={isDisabled}
                    className={cn(chipStyles({ selected: isSelected }), isDisabled && "cursor-not-allowed opacity-40")}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            <div className={actions}>
              <Button variant="secondary" size="lg" className="sm:flex-1" onClick={goBack}>
                Back
              </Button>
              <Button size="lg" className="sm:flex-1" disabled={selectedCategories.length === 0} onClick={goNext}>
                Continue
              </Button>
            </div>
            <div className="mt-4 text-center">
              <button type="button" onClick={goNext} className={backLink}>
                Skip for now →
              </button>
            </div>
          </section>
        )}

        {/* ── Seniority & Work Arrangement ── */}
        {currentKey === "seniority" && (
          <form onSubmit={handleSubmit} aria-labelledby="sen-heading" className={cardCls}>
            <h2 id="sen-heading" className={stepHeading}>Your preferences</h2>
            <p className="mt-2 text-body text-ink-muted">Optional — helps narrow down results</p>

            <fieldset className="mt-7">
              <legend className="text-body-sm font-medium text-ink">What level are you at?</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {SENIORITY_LEVELS.map((s) => {
                  const on = selectedSeniorities.includes(s.value);
                  return (
                    <button
                      key={s.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleSeniority(s.value)}
                      className={chipStyles({ selected: on })}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mt-7">
              <legend className="text-body-sm font-medium text-ink">What work arrangement do you prefer?</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {WORK_ARRANGEMENTS.map((w) => {
                  const on = selectedWorkArrangements.includes(w);
                  return (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleWorkArrangement(w)}
                      className={chipStyles({ selected: on })}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {error && <Notice tone="danger" className="mt-6">{error}</Notice>}

            <div className={actions}>
              <Button variant="secondary" size="lg" className="sm:flex-1" onClick={goBack}>
                Back
              </Button>
              <Button type="submit" size="lg" className="sm:flex-1" disabled={loading} loading={loading}>
                {loading ? "Saving…" : isUpdate ? "Save changes" : "Continue"}
              </Button>
            </div>
            {loading && file && (
              <p className="mt-4 text-center text-body-sm text-ink-subtle">
                Processing your CV in the background — this may take a moment.
              </p>
            )}
          </form>
        )}

        {/* ── Plan ── */}
        {currentKey === "plan" && (
          <section aria-labelledby="plan-heading">
            <div className={cn(cardCls, "text-center")}>
              <h2 id="plan-heading" className={stepHeading}>You&apos;re all set!</h2>
              <p className="mt-2 text-body text-ink-muted">Choose a plan to start applying</p>
            </div>

            <div className="mt-6 grid grid-cols-1 items-stretch gap-5 md:grid-cols-3">
              {PLAN_TIERS.map((tier) => {
                const isCurrent = currentPlan !== null && tier.key === currentPlan;
                const isPaidUser = currentPlan === "pro" || currentPlan === "unlimited";
                const rank = (k: string) => (k === "unlimited" ? 2 : k === "pro" ? 1 : 0);
                const ctaLabel = isCurrent
                  ? "Current plan"
                  : isPaidUser && tier.key !== "free"
                  ? rank(tier.key) > rank(currentPlan) ? "Upgrade" : "Downgrade"
                  : tier.ctaLabel;
                return (
                  <div
                    key={tier.key}
                    className={cn(
                      "flex flex-col rounded-[1.375rem] p-6 sm:p-7",
                      tier.highlighted ? "bg-surface-raised shadow-dossier ring-1 ring-accent/50" : "border border-line bg-surface",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-serif text-[1.5rem] font-medium leading-tight text-ink">{tier.name}</h3>
                      {tier.highlighted && <Badge tone="accent">Most Popular</Badge>}
                    </div>
                    <p className="mt-4">
                      <span className="numerals font-serif text-[2.75rem] font-medium leading-none text-ink">{tier.price}</span>
                      <span className="ml-1.5 text-body-sm text-ink-muted">/month</span>
                    </p>

                    <ul className="mt-6 flex-1 space-y-2.5 border-t border-line pt-6">
                      {tier.features.map((f) => (
                        <li key={f} className="flex items-start gap-2.5 text-body-sm text-ink">
                          <CheckIcon className="mt-0.5 h-4 w-4 text-brand-text" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      variant={isCurrent ? "current" : tier.highlighted ? "accent" : "secondary"}
                      size="lg"
                      block
                      className="mt-7"
                      disabled={planActionLoading !== null || isCurrent}
                      loading={planActionLoading === tier.key}
                      onClick={() => handlePlanChoice(tier)}
                    >
                      {planActionLoading === tier.key ? "…" : ctaLabel}
                    </Button>
                  </div>
                );
              })}
            </div>

            <p className="mx-auto mt-6 max-w-2xl text-center text-body-sm text-ink-muted">{INCLUDED_IN_EVERY_PLAN}</p>
            {planError && <Notice tone="danger" className="mx-auto mt-6 max-w-lg">{planError}</Notice>}

            <div className="mt-6 flex justify-center">
              <Button
                variant="secondary"
                size="lg"
                onClick={goBack}
                disabled={planActionLoading !== null}
              >
                Back
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
