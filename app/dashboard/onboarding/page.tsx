"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type WorkMode = "remote" | "hybrid" | "onsite";

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
    min_salary?: number;
  };
  google_connected?: boolean;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isUpdate, setIsUpdate] = useState(false);
  const [existingCV, setExistingCV] = useState<ExistingCV | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Step 1 — cv path choice
  const [cvPath, setCvPath] = useState<"upload" | null>(null);
  const [file, setFile] = useState<File | null>(null);

  // Step 2
  const [titleInput, setTitleInput] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [workMode, setWorkMode] = useState<WorkMode>("hybrid");
  const [minSalary, setMinSalary] = useState("");
  const [skipSalary, setSkipSalary] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [googleConnected, setGoogleConnected] = useState(false);

  // Load existing CV and preferences on mount
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
          if (prefs.locations?.[0]) setLocation(prefs.locations[0]);
          if (prefs.remote_ok) setWorkMode("remote");
          if (prefs.min_salary) setMinSalary(String(prefs.min_salary));
          else setSkipSalary(true);
        }
        if (d.google_connected) setGoogleConnected(true);
      })
      .catch(() => {/* ignore, treat as new user */})
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (file) {
        // New file provided — full CV upload (upserts CV row + re-embeds)
        const form = new FormData();
        form.append("cv", file);
        form.append("titles", JSON.stringify(titles));
        form.append("location", location);
        form.append("remote_ok", String(workMode === "remote"));
        form.append("min_salary", skipSalary ? "" : minSalary);

        const res = await fetch("/api/cv/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
      } else {
        // Returning user, no new file — just update preferences
        const res = await fetch("/api/profile/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            titles,
            locations: location ? [location] : [],
            remote_ok: workMode === "remote",
            min_salary: skipSalary ? null : (minSalary ? parseInt(minSalary) : null),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Update failed");
      }

      router.push(file ? "/dashboard/my-cv" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
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
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          {isUpdate ? "Update your profile" : "Set up your profile"}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Step {step} of 2</p>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2 mb-8">
        {[1, 2].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              s <= step ? "bg-black dark:bg-white" : "bg-gray-200 dark:bg-gray-700"
            }`}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          {/* Existing CV preview for returning users */}
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

          {/* Two-card choice */}
          {cvPath === null && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Upload card */}
              <button
                type="button"
                onClick={() => setCvPath("upload")}
                className="flex flex-col items-center gap-3 border-2 rounded-xl p-6 text-center hover:border-black hover:bg-gray-50 transition-all group"
              >
                <div className="w-10 h-10 rounded-full bg-gray-100 group-hover:bg-black flex items-center justify-center transition-colors">
                  <svg className="w-5 h-5 text-gray-600 group-hover:text-white transition-colors" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0L8 8m4-4l4 4" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{isUpdate ? "Replace CV" : "Upload existing CV"}</p>
                  <p className="text-xs text-gray-500 mt-0.5">PDF document</p>
                </div>
                <span className="text-xs font-medium border border-gray-300 px-3 py-1 rounded-lg group-hover:border-black transition-colors">
                  {isUpdate ? "Upload new PDF" : "Upload CV"}
                </span>
              </button>

              {/* Build with AI card */}
              <button
                type="button"
                onClick={() => router.push("/dashboard/cv-builder")}
                className="flex flex-col items-center gap-3 border-2 rounded-xl p-6 text-center hover:border-purple-500 hover:bg-purple-50 transition-all group"
              >
                <div className="w-10 h-10 rounded-full bg-purple-100 group-hover:bg-purple-500 flex items-center justify-center transition-colors">
                  <svg className="w-5 h-5 text-purple-600 group-hover:text-white transition-colors" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">Build CV with AI</p>
                  <p className="text-xs text-gray-500 mt-0.5">Answer a few questions, Claude writes it</p>
                </div>
                <span className="text-xs font-medium bg-purple-600 text-white px-3 py-1 rounded-lg group-hover:bg-purple-700 transition-colors">
                  Start building →
                </span>
              </button>
            </div>
          )}

          {/* Upload form — shown after choosing "Upload" */}
          {cvPath === "upload" && (
            <>
              <button type="button" onClick={() => setCvPath(null)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                ← Back to options
              </button>
              <label className="block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors">
                <input
                  type="file"
                  accept=".pdf"
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
                    {isUpdate ? "Click to choose a new PDF (optional)" : "Click to choose a PDF"}
                  </span>
                )}
              </label>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button
                disabled={!isUpdate && !file}
                onClick={() => setStep(2)}
                className="w-full bg-black dark:bg-white dark:text-black text-white py-2 rounded text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-40"
              >
                Continue
              </button>
            </>
          )}

          {/* For returning users with no path chosen — allow skipping to step 2 */}
          {isUpdate && cvPath === null && (
            <button
              onClick={() => setStep(2)}
              className="w-full border dark:border-gray-600 py-2 rounded text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Keep current CV, update preferences only →
            </button>
          )}
        </div>
      )}

      {step === 2 && (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Job titles */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Job titles you&apos;re looking for
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addTitle(); }
                }}
                placeholder="e.g. Frontend Developer"
                className="flex-1 border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-gray-400"
              />
              <button
                type="button"
                onClick={addTitle}
                className="px-3 py-2 bg-gray-100 rounded text-sm hover:bg-gray-200"
              >
                Add
              </button>
            </div>
            {titles.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {titles.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 bg-black text-white text-xs px-2 py-1 rounded-full"
                  >
                    {t}
                    <button type="button" onClick={() => removeTitle(t)} className="hover:opacity-70">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium mb-1">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Tel Aviv"
              className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-gray-400"
            />
          </div>

          {/* Work mode */}
          <div>
            <label className="block text-sm font-medium mb-2">Work mode</label>
            <div className="flex gap-4">
              {(["remote", "hybrid", "onsite"] as WorkMode[]).map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="workMode"
                    value={m}
                    checked={workMode === m}
                    onChange={() => setWorkMode(m)}
                  />
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </label>
              ))}
            </div>
          </div>

          {/* Min salary */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">Minimum salary</label>
              <button
                type="button"
                onClick={() => { setSkipSalary((v) => !v); setMinSalary(""); }}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
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
            {skipSalary && (
              <p className="text-sm text-gray-400 italic">No minimum salary set</p>
            )}
          </div>

          {/* Google Calendar */}
          <div className="border dark:border-gray-600 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Google Calendar</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Get interview reminders added automatically
              </p>
            </div>
            {googleConnected ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Connected
              </span>
            ) : (
              <Link
                href="/api/auth/google"
                className="text-xs font-semibold bg-black text-white px-3 py-1.5 rounded-lg hover:bg-gray-800"
              >
                Connect
              </Link>
            )}
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 border py-2 rounded text-sm hover:bg-gray-50"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={loading || titles.length === 0}
              className="flex-1 bg-black text-white py-2 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-40"
            >
              {loading ? "Saving…" : isUpdate ? "Update CV" : "Save & continue"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
