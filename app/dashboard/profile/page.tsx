"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/app/components/Toast";

type WorkMode = "remote" | "hybrid" | "onsite";

interface Profile {
  cv: { clean_summary: string | null; skills_json: string | null; updated_at: string } | null;
  preferences: { titles: string[]; locations: string[]; remote_ok: boolean; min_salary: number | null } | null;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // CV section
  const [file, setFile] = useState<File | null>(null);

  // Preferences section
  const [titleInput, setTitleInput] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [workMode, setWorkMode] = useState<WorkMode>("hybrid");
  const [minSalary, setMinSalary] = useState("");
  const [skipSalary, setSkipSalary] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // LinkedIn session state
  const [linkedinConnected, setLinkedinConnected] = useState(false);
  const [linkedinConnecting, setLinkedinConnecting] = useState(false);
  const [linkedinModal, setLinkedinModal] = useState(false);
  const [linkedinError, setLinkedinError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data: Profile) => {
        setProfile(data);
        if (data.preferences) {
          setTitles(data.preferences.titles ?? []);
          setLocation(data.preferences.locations?.[0] ?? "");
          setWorkMode(data.preferences.remote_ok ? "remote" : "hybrid");
          if (data.preferences.min_salary) {
            setMinSalary(String(data.preferences.min_salary));
          } else {
            setSkipSalary(true);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Check LinkedIn session status on mount
    fetch("/api/linkedin/session-status")
      .then((r) => r.json())
      .then((d) => { if (d.connected) setLinkedinConnected(true); })
      .catch(() => {});
  }, []);

  // Cleanup polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function handleConnectLinkedin() {
    setLinkedinError("");
    setLinkedinConnecting(true);
    setLinkedinModal(true);

    try {
      const res = await fetch("/api/linkedin/start-session", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to start session");
    } catch (err) {
      setLinkedinError(err instanceof Error ? err.message : "Failed to start");
      setLinkedinConnecting(false);
      return;
    }

    // Poll every 3 s for up to 2 minutes
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 3;
      try {
        const res = await fetch("/api/linkedin/session-status");
        const data = await res.json();
        if (data.connected) {
          clearInterval(pollRef.current!);
          setLinkedinConnected(true);
          setLinkedinConnecting(false);
          setLinkedinModal(false);
          showToast("LinkedIn connected!", "success");
          return;
        }
        if (data.login_status === "timeout" || data.login_status === "error") {
          clearInterval(pollRef.current!);
          setLinkedinConnecting(false);
          setLinkedinError(
            data.login_status === "timeout"
              ? "Timed out — you have 2 minutes to log in. Try again."
              : "Something went wrong. Try again."
          );
          return;
        }
      } catch { /* ignore transient errors */ }

      if (elapsed >= 120) {
        clearInterval(pollRef.current!);
        setLinkedinConnecting(false);
        setLinkedinError("Timed out after 2 minutes. Try again.");
      }
    }, 3000);
  }

  function cancelLinkedinConnect() {
    if (pollRef.current) clearInterval(pollRef.current);
    setLinkedinConnecting(false);
    setLinkedinModal(false);
    setLinkedinError("");
  }

  function addTitle() {
    const t = titleInput.trim();
    if (t && !titles.includes(t)) setTitles([...titles, t]);
    setTitleInput("");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!file && titles.length === 0) {
      setError("Add at least one job title.");
      return;
    }
    setError("");
    setSaving(true);

    const form = new FormData();
    // If no new file, send a placeholder so the API knows to skip CV re-processing
    if (file) form.append("cv", file);
    else {
      // Send an empty cv blob so the upload endpoint skips PDF parsing
      form.append("cv_skip", "true");
    }
    form.append("titles", JSON.stringify(titles));
    form.append("location", location);
    form.append("remote_ok", String(workMode === "remote"));
    form.append("min_salary", skipSalary ? "" : minSalary);

    // If we have a new CV file, use the full upload endpoint
    const endpoint = file ? "/api/cv/upload" : "/api/profile/preferences";
    const res = await fetch(endpoint, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      setSaving(false);
      return;
    }

    showToast("Profile updated", "success");
    setSaving(false);
    setFile(null);
    // Refresh profile data
    fetch("/api/profile")
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => {});
  }

  const skills = (() => {
    if (!profile?.cv?.skills_json) return [];
    try {
      const parsed = typeof profile.cv.skills_json === "string"
        ? JSON.parse(profile.cv.skills_json)
        : profile.cv.skills_json;
      return parsed?.skills ?? [];
    } catch { return []; }
  })();

  if (loading) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white border rounded-xl h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* LinkedIn instruction modal */}
      {linkedinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Connect LinkedIn</h2>
            {linkedinConnecting && !linkedinError ? (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  A browser window is opening on this machine. Log in to LinkedIn normally —
                  the window will close automatically once you&apos;re signed in.
                </p>
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-5">
                  <span className="inline-flex gap-0.5">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span className="text-sm text-blue-700">Waiting for login… (up to 2 minutes)</span>
                </div>
              </>
            ) : null}
            {linkedinError && (
              <p className="text-sm text-red-600 mb-4">{linkedinError}</p>
            )}
            <button
              onClick={cancelLinkedinConnect}
              className="w-full border rounded-lg py-2 text-sm hover:bg-gray-50"
            >
              {linkedinConnecting ? "Cancel" : "Close"}
            </button>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-xl font-semibold text-gray-900">Your Profile</h1>
        <p className="text-sm text-gray-500 mt-0.5">Update your CV and job preferences</p>
      </div>

      {/* Current CV status */}
      {profile?.cv && (
        <div className="bg-white border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Current CV</h2>
            <span className="text-xs text-gray-400">
              Last updated {new Date(profile.cv.updated_at).toLocaleDateString("en-GB", {
                day: "numeric", month: "short", year: "numeric",
              })}
            </span>
          </div>
          {profile.cv.clean_summary && (
            <p className="text-sm text-gray-600 mb-3 line-clamp-3">{profile.cv.clean_summary}</p>
          )}
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {skills.slice(0, 12).map((s: string) => (
                <span key={s} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {s}
                </span>
              ))}
              {skills.length > 12 && (
                <span className="text-xs text-gray-400">+{skills.length - 12} more</span>
              )}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {/* CV upload */}
        <div className="bg-white border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            {profile?.cv ? "Replace CV (optional)" : "Upload CV"}
          </h2>
          <label className="block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-gray-400 transition-colors">
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
              <span className="text-sm font-medium text-gray-800">{file.name}</span>
            ) : (
              <span className="text-sm text-gray-400">
                {profile?.cv ? "Click to upload a new PDF" : "Click to choose a PDF"}
              </span>
            )}
          </label>
        </div>

        {/* Job preferences */}
        <div className="bg-white border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Job Preferences</h2>

          <div>
            <label className="block text-sm font-medium mb-1">Job titles</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTitle(); } }}
                placeholder="e.g. Frontend Developer"
                className="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
              <button type="button" onClick={addTitle} className="px-3 py-2 bg-gray-100 rounded text-sm hover:bg-gray-200">Add</button>
            </div>
            {titles.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {titles.map((t) => (
                  <span key={t} className="flex items-center gap-1 bg-black text-white text-xs px-2 py-1 rounded-full">
                    {t}
                    <button type="button" onClick={() => setTitles(titles.filter((x) => x !== t))} className="hover:opacity-70">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

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

          <div>
            <label className="block text-sm font-medium mb-2">Work mode</label>
            <div className="flex gap-4">
              {(["remote", "hybrid", "onsite"] as WorkMode[]).map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="workMode" value={m} checked={workMode === m} onChange={() => setWorkMode(m)} />
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </label>
              ))}
            </div>
          </div>

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
            {skipSalary && <p className="text-sm text-gray-400 italic">No minimum salary set</p>}
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="flex-1 border py-2 rounded text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || titles.length === 0}
            className="flex-1 bg-black text-white py-2 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      {/* LinkedIn Connection */}
      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">LinkedIn Connection</h2>
            <p className="text-xs text-gray-500 mt-0.5">Required for Easy Apply automation</p>
          </div>
          {linkedinConnected ? (
            <div className="flex items-center gap-3 shrink-0">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Connected
              </span>
              <button
                onClick={handleConnectLinkedin}
                disabled={linkedinConnecting}
                className="text-xs text-gray-500 hover:underline disabled:opacity-50"
              >
                Reconnect
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 shrink-0">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-100 px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                Not connected
              </span>
              <button
                onClick={handleConnectLinkedin}
                disabled={linkedinConnecting}
                className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {linkedinConnecting ? "Connecting…" : "Connect LinkedIn"}
              </button>
            </div>
          )}
        </div>
        {!linkedinConnected && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            Easy Apply won&apos;t work until LinkedIn is connected. Click Connect and log in when the browser opens.
          </p>
        )}
      </div>
    </div>
  );
}
