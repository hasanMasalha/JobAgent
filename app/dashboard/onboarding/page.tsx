"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type WorkMode = "remote" | "hybrid" | "onsite";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // Step 1
  const [file, setFile] = useState<File | null>(null);

  // Step 2
  const [titleInput, setTitleInput] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [workMode, setWorkMode] = useState<WorkMode>("hybrid");
  const [minSalary, setMinSalary] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    if (!file) return;
    setError("");
    setLoading(true);

    const form = new FormData();
    form.append("cv", file);
    form.append("titles", JSON.stringify(titles));
    form.append("location", location);
    form.append("remote_ok", String(workMode === "remote"));
    form.append("min_salary", minSalary);

    const res = await fetch("/api/cv/upload", { method: "POST", body: form });
    const text = await res.text();
    let data: { error?: string; success?: boolean } = {};
    try {
      data = JSON.parse(text);
    } catch {
      setError(`Server error: ${text || res.statusText}`);
      setLoading(false);
      return;
    }

    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-6">Set up your profile</h1>

      {/* Step indicator */}
      <div className="flex gap-2 mb-8">
        {[1, 2].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${
              s <= step ? "bg-black" : "bg-gray-200"
            }`}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Upload your CV (PDF, max 5MB)</p>
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
                Click to choose a PDF
              </span>
            )}
          </label>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            disabled={!file}
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
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTitle();
                  }
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
                    <button
                      type="button"
                      onClick={() => removeTitle(t)}
                      className="hover:opacity-70"
                    >
                      ×
                    </button>
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
            <label className="block text-sm font-medium mb-1">
              Minimum salary (optional)
            </label>
            <input
              type="number"
              value={minSalary}
              onChange={(e) => setMinSalary(e.target.value)}
              placeholder="e.g. 15000"
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
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
              {loading ? "Saving…" : "Save & continue"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
