"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { JOB_CATEGORIES, SENIORITY_LEVELS, CATEGORY_KEYWORDS } from "@/lib/job-categories";

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

const PLAN_TIERS: PlanTier[] = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    features: ["10 AI job matches per day", "5 auto-applies per month"],
    ctaLabel: "Start Free",
    destination: "/dashboard",
  },
  {
    key: "pro",
    name: "Pro",
    price: "$24",
    features: [
      "100 auto-applies per month",
      "AI CV tailoring per job",
      "All ATS platforms (Greenhouse, Lever, Comeet, Ashby)",
      "Chrome extension access",
    ],
    ctaLabel: "Upgrade to Pro",
    destination: "/pricing",
    highlighted: true,
  },
  {
    key: "unlimited",
    name: "Unlimited",
    price: "$69",
    features: [
      "Unlimited auto-applies",
      "Priority matching",
      "Multiple CV versions",
      "Analytics dashboard",
    ],
    ctaLabel: "Go Unlimited",
    destination: "/pricing",
  },
];

const WELCOME_BULLETS = [
  "AI matches you to the best jobs globally",
  "Auto-applies to Greenhouse, Lever, Comeet & more",
  "Tailors your CV for every application",
];

const COUNTRIES = [
  "United States", "United Kingdom", "Canada", "Australia", "Germany",
  "France", "Netherlands", "Israel", "Singapore", "UAE", "India",
  "Sweden", "Switzerland", "Denmark", "Norway", "Finland", "Spain",
  "Italy", "Poland", "Portugal", "Remote",
];

const WORK_ARRANGEMENTS = ["Remote", "Hybrid", "On-site", "Open to all"];

function CheckIcon() {
  return (
    <svg className="w-4 h-4 shrink-0 mt-0.5 text-[#1a2e5e] dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 010 1.415l-7.5 7.5a1 1 0 01-1.415 0l-3.5-3.5a1 1 0 111.415-1.415L8.5 12.086l6.79-6.796a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

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
      const res = await fetch("/api/onboarding/complete", { method: "POST" });
      if (!res.ok) throw new Error("Failed to complete onboarding");
      router.push(tier.destination);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setPlanActionLoading(null);
    }
  }

  if (profileLoading) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center">
        <div className="inline-block w-6 h-6 border-4 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`mx-auto ${currentKey === "plan" ? "max-w-4xl" : "max-w-lg"}`}>
      {currentKey !== "welcome" && (
        <div className="mb-6">
          <h1 className="text-xl font-semibold">
            {isUpdate ? "Update your profile" : "Set up your profile"}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Step {step} of {TOTAL_STEPS}</p>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex gap-2 mb-8">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              s <= step ? "bg-black dark:bg-white" : "bg-gray-200 dark:bg-gray-700"
            }`}
          />
        ))}
      </div>

      {/* ── Welcome ── */}
      {currentKey === "welcome" && (
        <div className="flex flex-col items-center text-center space-y-6 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="JobAgent" className="block dark:hidden" style={{ height: 56 }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/whiteLogo.png" alt="JobAgent" className="hidden dark:block" style={{ height: 56 }} />

          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white leading-snug">
            Apply to hundreds of jobs automatically
          </h2>

          <ul className="space-y-3 text-left w-full max-w-sm">
            {WELCOME_BULLETS.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                <CheckIcon />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={goNext}
            className="w-full bg-[#1a2e5e] text-white py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Get Started →
          </button>
        </div>
      )}

      {/* ── CV ── */}
      {currentKey === "cv" && (
        <div className="space-y-4">
          {!isUpdate && (
            <button
              type="button"
              onClick={goBack}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
              ← Back
            </button>
          )}

          {isUpdate && existingCV && (
            <div className="bg-gray-50 dark:bg-gray-700/50 border dark:border-gray-600 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Current CV</p>
              {existingCV.skills_json?.skills?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {existingCV.skills_json.skills.slice(0, 12).map((s) => (
                    <span key={s} className="text-xs bg-white dark:bg-gray-700 border dark:border-gray-600 px-2 py-0.5 rounded-full text-gray-700 dark:text-gray-300">{s}</span>
                  ))}
                  {existingCV.skills_json.skills.length > 12 && (
                    <span className="text-xs text-gray-400">+{existingCV.skills_json.skills.length - 12} more</span>
                  )}
                </div>
              ) : null}
              {existingCV.skills_json?.years_experience != null && (
                <p className="text-xs text-gray-500">
                  {existingCV.skills_json.years_experience} year{existingCV.skills_json.years_experience === 1 ? "" : "s"} experience
                </p>
              )}
              <p className="text-xs text-gray-400">
                Last updated {new Date(existingCV.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          )}

          {!isUpdate && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Upload your CV to get personalized matches
            </p>
          )}

          {cvPath === null && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => setCvPath("upload")}
                className="flex flex-col items-center gap-3 border-2 rounded-xl p-6 text-center bg-white dark:bg-gray-800 dark:border-gray-600 hover:border-black dark:hover:border-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all group"
              >
                <div className="w-10 h-10 rounded-full bg-gray-100 group-hover:bg-black flex items-center justify-center transition-colors">
                  <svg className="w-5 h-5 text-gray-600 group-hover:text-white transition-colors" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0L8 8m4-4l4 4" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{isUpdate ? "Replace CV" : "Upload existing CV"}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">PDF or Word document (.pdf, .docx)</p>
                </div>
                <span className="text-xs font-medium border border-gray-300 dark:border-gray-500 dark:text-gray-300 px-3 py-1 rounded-lg group-hover:border-black dark:group-hover:border-gray-300 transition-colors">
                  {isUpdate ? "Upload new CV" : "Upload CV"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => router.push("/dashboard/cv-builder")}
                className="flex flex-col items-center gap-3 border-2 rounded-xl p-6 text-center bg-white dark:bg-gray-800 dark:border-gray-600 hover:border-purple-500 hover:bg-purple-50 dark:hover:border-purple-400 dark:hover:bg-purple-900/20 transition-all group"
              >
                <div className="w-10 h-10 rounded-full bg-purple-100 group-hover:bg-purple-500 flex items-center justify-center transition-colors">
                  <svg className="w-5 h-5 text-purple-600 group-hover:text-white transition-colors" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Build CV with AI</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Answer a few questions, Claude writes it</p>
                </div>
                <span className="text-xs font-medium bg-purple-600 text-white px-3 py-1 rounded-lg group-hover:bg-purple-700 transition-colors">
                  Start building →
                </span>
              </button>
            </div>
          )}

          {cvPath === "upload" && (
            <>
              <button type="button" onClick={() => setCvPath(null)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                ← Back to options
              </button>
              <label className="block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors">
                <input
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && f.size > 5 * 1024 * 1024) { setError("File must be under 5MB"); return; }
                    setError("");
                    setFile(f ?? null);
                  }}
                />
                {file ? (
                  <span className="text-sm font-medium">{file.name}</span>
                ) : (
                  <span className="text-sm text-gray-400">
                    {isUpdate ? "Click to choose a new PDF or Word file (optional)" : "Click to choose a PDF or Word file (.docx)"}
                  </span>
                )}
              </label>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button
                disabled={!isUpdate && !file}
                onClick={goNext}
                className="w-full bg-black dark:bg-white dark:text-black text-white py-2 rounded text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-40"
              >
                Continue
              </button>
            </>
          )}

          {isUpdate && cvPath === null && (
            <button
              onClick={goNext}
              className="w-full border dark:border-gray-600 py-2 rounded text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Keep current CV, update preferences only →
            </button>
          )}
        </div>
      )}

      {/* ── Preferences ── */}
      {currentKey === "preferences" && (
        <div className="space-y-5">
          {/* Job titles */}
          <div>
            <label className="block text-sm font-medium mb-1">Job titles you&apos;re looking for</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTitle(); } }}
                placeholder="e.g. Frontend Developer"
                className="flex-1 border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-gray-400"
              />
              <button type="button" onClick={addTitle} className="bg-gray-100 dark:bg-gray-600 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-500 rounded-md px-3 py-1.5 text-sm hover:bg-gray-200 dark:hover:bg-gray-500">
                Add
              </button>
            </div>
            {titles.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {titles.map((t) => (
                  <span key={t} className="flex items-center gap-1 bg-black text-white text-xs px-2 py-1 rounded-full">
                    {t}
                    <button type="button" onClick={() => removeTitle(t)} className="hover:opacity-70">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Location */}
          <div className="relative">
            <label className="block text-sm font-medium mb-1">Location</label>
            <input
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
              className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-gray-400"
            />
            {locationDropdownOpen && filteredCountries.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-lg shadow-lg py-1">
                {filteredCountries.map((c) => (
                  <li key={c}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setLocation(c);
                        setLocationQuery(c);
                        setLocationDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 ${
                        location === c ? "bg-gray-100 dark:bg-gray-600 font-medium text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"
                      }`}
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
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">Minimum salary</label>
              <button type="button" onClick={() => { setSkipSalary((v) => !v); setMinSalary(""); }} className="text-xs text-gray-400 hover:text-gray-600 underline">
                {skipSalary ? "Add salary" : "Skip salary"}
              </button>
            </div>
            {!skipSalary && (
              <input
                type="number"
                value={minSalary}
                onChange={(e) => setMinSalary(e.target.value)}
                placeholder="e.g. 15000"
                className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-gray-400"
              />
            )}
            {skipSalary && <p className="text-sm text-gray-400 italic">No minimum salary set</p>}
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={goBack} className="flex-1 border py-2 rounded text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
              Back
            </button>
            <button
              type="button"
              disabled={titles.length === 0}
              onClick={goNext}
              className="flex-1 bg-black text-white py-2 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* ── Categories ── */}
      {currentKey === "categories" && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">What job are you looking for?</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Pick up to 4 categories
              <span className="ml-2 font-medium text-gray-700 dark:text-gray-300">
                {selectedCategories.length}/4 selected
              </span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {JOB_CATEGORIES.map((cat) => {
              const isSelected = selectedCategories.includes(cat);
              const isDisabled = !isSelected && selectedCategories.length >= 4;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  disabled={isDisabled}
                  className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                    isSelected
                      ? "bg-violet-600 text-white border-violet-600"
                      : isDisabled
                      ? "opacity-40 cursor-not-allowed bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-violet-400 hover:text-violet-700 dark:hover:text-violet-300"
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={goBack} className="flex-1 border py-2 rounded text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
              Back
            </button>
            <button
              type="button"
              disabled={selectedCategories.length === 0}
              onClick={goNext}
              className="flex-1 bg-black text-white py-2 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-40"
            >
              Continue
            </button>
          </div>
          <button type="button" onClick={goNext} className="w-full text-xs text-gray-400 hover:text-gray-600 py-1">
            Skip for now →
          </button>
        </div>
      )}

      {/* ── Seniority & Work Arrangement ── */}
      {currentKey === "seniority" && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Your preferences</h2>
            <p className="text-sm text-gray-500 mt-0.5">Optional — helps narrow down results</p>
          </div>

          {/* Seniority */}
          <div>
            <p className="text-sm font-medium mb-2 text-gray-800 dark:text-gray-200">What level are you at?</p>
            <div className="flex flex-wrap gap-2">
              {SENIORITY_LEVELS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleSeniority(s.value)}
                  className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                    selectedSeniorities.includes(s.value)
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-violet-400"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Work arrangement */}
          <div>
            <p className="text-sm font-medium mb-2 text-gray-800 dark:text-gray-200">What work arrangement do you prefer?</p>
            <div className="flex flex-wrap gap-2">
              {WORK_ARRANGEMENTS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => toggleWorkArrangement(w)}
                  className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                    selectedWorkArrangements.includes(w)
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-violet-400"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={goBack} className="flex-1 border py-2 rounded text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
              Back
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-black text-white py-2 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-40"
            >
              {loading ? "Saving…" : isUpdate ? "Save changes" : "Continue"}
            </button>
          </div>
          {loading && file && (
            <p className="text-xs text-center text-gray-400 dark:text-gray-500">
              Processing your CV in the background — this may take a moment.
            </p>
          )}
        </form>
      )}

      {/* ── Plan ── */}
      {currentKey === "plan" && (
        <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">You&apos;re all set!</h2>
            <p className="text-sm text-gray-500 mt-0.5">Choose a plan to start applying</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 items-start">
            {PLAN_TIERS.map((tier) => (
              <div
                key={tier.key}
                className={`relative rounded-2xl p-6 flex flex-col h-full ${
                  tier.highlighted
                    ? "bg-blue-50/60 dark:bg-gray-800 border-2 border-[#1a2e5e] dark:border-blue-400 shadow-xl md:scale-105"
                    : "bg-white dark:bg-gray-800 border dark:border-gray-700 shadow-sm"
                }`}
              >
                {tier.highlighted && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-semibold text-white px-3 py-1 rounded-full whitespace-nowrap"
                    style={{ background: "#1a2e5e" }}
                  >
                    Most Popular
                  </span>
                )}

                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{tier.name}</h3>
                <p className="mt-3 text-3xl font-bold text-gray-900 dark:text-white">
                  {tier.price}
                  <span className="text-sm font-normal text-gray-500 dark:text-gray-400">/month</span>
                </p>

                <ul className="mt-5 space-y-2.5 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <CheckIcon />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  disabled={planActionLoading !== null}
                  onClick={() => handlePlanChoice(tier)}
                  className={`mt-6 w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 ${
                    tier.highlighted ? "text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  }`}
                  style={tier.highlighted ? { background: "#1a2e5e" } : undefined}
                >
                  {planActionLoading === tier.key ? "…" : tier.ctaLabel}
                </button>
              </div>
            ))}
          </div>

          {planError && <p className="text-red-600 text-sm text-center">{planError}</p>}

          <button
            type="button"
            onClick={goBack}
            disabled={planActionLoading !== null}
            className="w-full max-w-lg mx-auto block border dark:border-gray-600 py-2 rounded text-sm hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}
