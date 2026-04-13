"use client";

import { useEffect, useState, KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { showToast } from "@/app/components/Toast";

type WorkMode = "remote" | "hybrid" | "onsite";

const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

function PreferencesContent() {
  const searchParams = useSearchParams();

  // Job preferences
  const [titles, setTitles] = useState<string[]>([]);
  const [titleInput, setTitleInput] = useState("");
  const [location, setLocation] = useState("");
  const [workModes, setWorkModes] = useState<WorkMode[]>(["hybrid"]);
  const [minSalary, setMinSalary] = useState("");

  // Email notifications
  const [emailNotifications, setEmailNotifications] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [unsubscribed, setUnsubscribed] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d.preferences) {
          const p = d.preferences;
          if (p.titles?.length) setTitles(p.titles);
          if (p.locations?.[0]) setLocation(p.locations[0]);
          if (p.remote_ok) setWorkModes(["remote"]);
          if (p.min_salary) setMinSalary(String(p.min_salary));
        }
        if (typeof d.email_notifications === "boolean") {
          setEmailNotifications(d.email_notifications);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Auto-unsubscribe when ?unsubscribe=true
  useEffect(() => {
    if (searchParams.get("unsubscribe") === "true" && !loading) {
      handleEmailToggle(false);
      setUnsubscribed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function addTitle() {
    const t = titleInput.trim();
    if (t && !titles.includes(t)) setTitles((prev) => [...prev, t]);
    setTitleInput("");
  }

  function handleTitleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); addTitle(); }
    if (e.key === "Backspace" && !titleInput && titles.length) {
      setTitles((prev) => prev.slice(0, -1));
    }
  }

  function toggleWorkMode(mode: WorkMode) {
    setWorkModes((prev) =>
      prev.includes(mode)
        ? prev.length > 1 ? prev.filter((m) => m !== mode) : prev
        : [...prev, mode]
    );
  }

  async function handleSavePreferences() {
    setSaving(true);
    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_preferences: {
            titles,
            locations: location.trim() ? [location.trim()] : [],
            remote_ok: workModes.includes("remote"),
            min_salary: minSalary ? parseInt(minSalary) : null,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast("Preferences saved — next job refresh will use these settings");
    } catch {
      showToast("Failed to save preferences", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleEmailToggle(value: boolean) {
    setEmailNotifications(value);
    setSavingEmail(true);
    try {
      await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_notifications: value }),
      });
    } finally {
      setSavingEmail(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto mt-20 text-center">
        <div className="inline-block w-6 h-6 border-4 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Preferences</h1>
        <p className="text-sm text-gray-500 mt-0.5">Control how JobAgent finds and notifies you about jobs.</p>
      </div>

      {unsubscribed && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
          You&apos;ve been unsubscribed from daily emails.
        </div>
      )}

      {/* ── Job Search Preferences ── */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Job search
        </h2>
        <div className="bg-white border rounded-2xl divide-y">

          {/* Job titles */}
          <div className="px-5 py-4">
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Job titles you&apos;re looking for
            </label>
            <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 border rounded-lg bg-gray-50 focus-within:ring-2 focus-within:ring-black focus-within:border-transparent">
              {titles.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 bg-black text-white text-xs px-2.5 py-1 rounded-full"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => setTitles(titles.filter((x) => x !== t))}
                    className="hover:opacity-70 leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={addTitle}
                placeholder={titles.length === 0 ? "e.g. Backend Developer" : ""}
                className="flex-1 min-w-[140px] bg-transparent text-sm outline-none placeholder:text-gray-400"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">Press Enter to add each title</p>
          </div>

          {/* Location */}
          <div className="px-5 py-4">
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Preferred location
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Tel Aviv"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black bg-gray-50"
            />
          </div>

          {/* Work arrangement */}
          <div className="px-5 py-4">
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Work arrangement
            </label>
            <div className="flex gap-2">
              {(["remote", "hybrid", "onsite"] as WorkMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => toggleWorkMode(mode)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    workModes.includes(mode)
                      ? "bg-black text-white border-black"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-500"
                  }`}
                >
                  {WORK_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>

          {/* Min salary */}
          <div className="px-5 py-4">
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Minimum salary <span className="text-gray-400 font-normal">(₪)</span>
            </label>
            <input
              type="number"
              value={minSalary}
              onChange={(e) => setMinSalary(e.target.value)}
              placeholder="No minimum"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black bg-gray-50"
            />
          </div>

        </div>

        <button
          onClick={handleSavePreferences}
          disabled={saving || titles.length === 0}
          className="mt-4 w-full bg-black text-white py-2.5 rounded-xl text-sm font-medium hover:bg-gray-800 disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : "Save preferences"}
        </button>
      </section>

      {/* ── Divider ── */}
      <div className="border-t" />

      {/* ── Notifications ── */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Notifications
        </h2>
        <div className="bg-white border rounded-2xl">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-medium text-gray-900">Daily match emails</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Get an email each morning when new jobs are found
              </p>
            </div>
            <button
              onClick={() => handleEmailToggle(!emailNotifications)}
              disabled={savingEmail}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-60 ${
                emailNotifications ? "bg-black" : "bg-gray-200"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  emailNotifications ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function PreferencesPage() {
  return (
    <Suspense fallback={
      <div className="max-w-xl mx-auto mt-20 text-center">
        <div className="inline-block w-6 h-6 border-4 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <PreferencesContent />
    </Suspense>
  );
}
