"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type WorkMode = "remote" | "hybrid" | "onsite";

interface ExistingCV {
  clean_summary: string;
  skills_json: { skills?: string[]; years_experience?: number } | null;
  updated_at: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isUpdate, setIsUpdate] = useState(false);
  const [existingCV, setExistingCV] = useState<ExistingCV | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Step 1
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

  // Load existing CV and preferences on mount
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
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

      router.push("/dashboard");
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
              s <= step ? "bg-black" : "bg-gray-200"
            }`}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          {/* Existing CV preview */}
          {isUpdate && existingCV && (
            <div className="bg-gray-50 border rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Current CV</p>
              {existingCV.skills_json?.skills?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {existingCV.skills_json.skills.slice(0, 12).map((s) => (
                    <span key={s} className="text-xs bg-white border px-2 py-0.5 rounded-full text-gray-700">
                      {s}
                    </span>
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

          <p className="text-sm text-gray-600">
            {isUpdate ? "Upload a new CV to replace the current one (optional)" : "Upload your CV (PDF, max 5MB)"}
          </p>
          <label className="block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors">
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && f.size > 5 * 1024 * 1024) {
                  setError("File must be under 5MB");
                  return;
                }
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
            className="w-full bg-black text-white py-2 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-40"
          >
            Continue
          </button>
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
                className="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
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
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
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
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            )}
            {skipSalary && (
              <p className="text-sm text-gray-400 italic">No minimum salary set</p>
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
