"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { showToast } from "@/app/components/Toast";

interface Profile {
  cv: { clean_summary: string | null; skills_json: string | null; updated_at: string } | null;
  preferences: { titles: string[]; locations: string[]; remote_ok: boolean; work_modes: string[]; min_salary: number | null } | null;
}

function ProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // CV section
  const [file, setFile] = useState<File | null>(null);

  // Preferences section
  const [titleInput, setTitleInput] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [workModes, setWorkModes] = useState<string[]>(["Hybrid"]);
  const [minSalary, setMinSalary] = useState("");
  const [skipSalary, setSkipSalary] = useState(false);

  function toggleWorkMode(mode: string) {
    setWorkModes((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
    );
  }

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Notifications
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [savingEmail, setSavingEmail] = useState(false);

  // Google Calendar state
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleDisconnecting, setGoogleDisconnecting] = useState(false);

  // LinkedIn session state
  const [linkedinConnected, setLinkedinConnected] = useState(false);
  const [linkedinChecking, setLinkedinChecking] = useState(true);
  const [linkedinConnecting, setLinkedinConnecting] = useState(false);
  const [linkedinModal, setLinkedinModal] = useState(false);
  const [linkedinError, setLinkedinError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data: Profile & { email_notifications?: boolean }) => {
        setProfile(data);
        if (typeof data.email_notifications === "boolean") {
          setEmailNotifications(data.email_notifications);
        }
        if (data.preferences) {
          setTitles(data.preferences.titles ?? []);
          setLocation(data.preferences.locations?.[0] ?? "");
          if (data.preferences.work_modes?.length) {
            setWorkModes(data.preferences.work_modes);
          } else {
            setWorkModes(data.preferences.remote_ok ? ["Remote"] : ["Hybrid"]);
          }
          if (data.preferences.min_salary) {
            setMinSalary(String(data.preferences.min_salary));
          } else {
            setSkipSalary(true);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Check LinkedIn session status on mount — real Playwright validation (5-10 s)
    fetch("/api/linkedin/session-status")
      .then((r) => r.json())
      .then((d) => { setLinkedinConnected(!!d.connected); })
      .catch(() => {})
      .finally(() => setLinkedinChecking(false));

    // Check Google Calendar connection status on mount
    fetch("/api/auth/google/status")
      .then((r) => r.json())
      .then((d) => {
        setGoogleConnected(d.connected);
        setGoogleConfigured(d.configured ?? false);
        setGoogleEmail(d.email ?? null);
      })
      .catch(() => {});

    // Show toast if redirected back with google_not_configured
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("toast") === "google_not_configured") {
      showToast("Google Calendar is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI to .env.", "error");
      window.history.replaceState({}, "", "/dashboard/profile");
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Auto-unsubscribe when ?unsubscribe=true
  useEffect(() => {
    if (searchParams.get("unsubscribe") === "true" && !loading) {
      handleEmailToggle(false);
      showToast("You've been unsubscribed from daily emails.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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

    // Poll every 3 s for up to 2 minutes.
    // Uses /login-poll (fast in-memory check) — NOT /session-status — so the
    // heavy Playwright validation never runs while the login browser is open.
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 3;
      try {
        const res = await fetch("/api/linkedin/login-poll");
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

  async function handleDisconnectGoogle() {
    setGoogleDisconnecting(true);
    try {
      await fetch("/api/auth/google", { method: "DELETE" });
      setGoogleConnected(false);
      setGoogleEmail(null);
      showToast("Google Calendar disconnected", "success");
    } catch {
      showToast("Failed to disconnect", "error");
    } finally {
      setGoogleDisconnecting(false);
    }
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

    let res: Response;
    if (file) {
      const form = new FormData();
      form.append("cv", file);
      form.append("titles", JSON.stringify(titles));
      form.append("location", location);
      form.append("remote_ok", String(workModes.includes("Remote")));
      form.append("work_modes", JSON.stringify(workModes));
      form.append("min_salary", skipSalary ? "" : minSalary);
      res = await fetch("/api/cv/upload", { method: "POST", body: form });
    } else {
      res = await fetch("/api/profile/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titles,
          locations: location ? [location] : [],
          remote_ok: workModes.includes("Remote"),
          work_modes: workModes,
          min_salary: skipSalary ? null : (minSalary ? parseInt(minSalary) : null),
        }),
      });
    }
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
          <div key={i} className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl h-24 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* LinkedIn instruction modal */}
      {linkedinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Connect LinkedIn</h2>
            {linkedinConnecting && !linkedinError ? (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  A browser window is opening on this machine. Log in to LinkedIn normally —
                  the window will close automatically once you&apos;re signed in.
                </p>
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-3">
                  <span className="inline-flex gap-0.5">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span className="text-sm text-blue-700">Waiting for login… (up to 2 minutes)</span>
                </div>
                <button
                  onClick={async () => {
                    if (pollRef.current) clearInterval(pollRef.current);
                    await fetch("/api/linkedin/force-connected", { method: "POST" });
                    setLinkedinConnected(true);
                    setLinkedinConnecting(false);
                    setLinkedinModal(false);
                    showToast("LinkedIn connected!", "success");
                  }}
                  className="text-sm text-blue-600 hover:underline mb-5 block"
                >
                  I&apos;ve logged in — mark as connected
                </button>
              </>
            ) : null}
            {linkedinError && (
              <p className="text-sm text-red-600 mb-4">{linkedinError}</p>
            )}
            <button
              onClick={cancelLinkedinConnect}
              className="w-full border dark:border-gray-600 rounded-lg py-2 text-sm dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {linkedinConnecting ? "Cancel" : "Close"}
            </button>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Your Profile</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Update your CV and job preferences</p>
      </div>

      {/* Current CV status */}
      {profile?.cv && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Current CV</h2>
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
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            {profile?.cv ? "Replace CV (optional)" : "Upload CV"}
          </h2>
          <label className="block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-gray-400 transition-colors">
            <input
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.name.toLowerCase().endsWith(".doc") && !f.name.toLowerCase().endsWith(".docx")) {
                  setError("Old .doc format is not supported. Please save as .docx or .pdf.");
                  return;
                }
                if (f.size > 5 * 1024 * 1024) { setError("File must be under 5MB"); return; }
                setError("");
                setFile(f);
              }}
            />
            {file ? (
              <span className="text-sm font-medium text-gray-800">{file.name}</span>
            ) : (
              <span className="text-sm text-gray-400">
                {profile?.cv ? "Click to upload a new PDF or Word doc" : "Click to choose a PDF or Word doc (.pdf, .docx)"}
              </span>
            )}
          </label>
        </div>

        {/* Job preferences */}
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Job Preferences</h2>

          <div>
            <label className="block text-sm font-medium mb-1">Job titles</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTitle(); } }}
                placeholder="e.g. Frontend Developer"
                className="flex-1 border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-gray-400"
              />
              <button type="button" onClick={addTitle} className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-500 rounded-md text-sm hover:bg-gray-200 dark:hover:bg-gray-600">Add</button>
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
              className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Work mode</label>
            <div className="flex flex-wrap gap-2">
              {["Remote", "Hybrid", "On-site"].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => toggleWorkMode(mode)}
                  className={`px-4 py-2 rounded-full border text-sm transition-colors ${
                    workModes.includes(mode)
                      ? "bg-[#1a2e5e] text-white border-[#1a2e5e]"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600"
                  }`}
                >
                  {mode}
                </button>
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
                className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-gray-400"
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
            className="flex-1 border dark:border-gray-600 dark:text-gray-300 py-2 rounded text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || titles.length === 0}
            className="flex-1 bg-black dark:bg-white dark:text-black text-white py-2 rounded text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      {/* LinkedIn Connection */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">LinkedIn Connection</h2>
            <p className="text-xs text-gray-500 mt-0.5">Required for Easy Apply automation</p>
          </div>
          {linkedinChecking ? (
            <span className="text-xs text-gray-400 italic self-end sm:self-auto">Verifying LinkedIn connection…</span>
          ) : linkedinConnected ? (
            <div className="flex items-center gap-3 self-end sm:self-auto">
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
            <div className="flex items-center gap-3 self-end sm:self-auto">
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
        {!linkedinChecking && !linkedinConnected && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            Easy Apply won&apos;t work until LinkedIn is connected. Click Connect and log in when the browser opens.
          </p>
        )}
      </div>

      {/* Google Calendar Connection */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Google Calendar</h2>
            <p className="text-xs text-gray-500 mt-0.5">For scheduling interviews from the chat assistant</p>
          </div>
          {googleConnected ? (
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-100 px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Connected
              </span>
              <button
                onClick={handleDisconnectGoogle}
                disabled={googleDisconnecting}
                className="text-xs text-gray-500 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
              >
                {googleDisconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full">
                Not connected
              </span>
              {googleConfigured ? (
                <a
                  href="/api/auth/google"
                  className="text-xs font-semibold bg-black dark:bg-white dark:text-black text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                >
                  Connect Google Calendar
                </a>
              ) : (
                <span className="text-xs text-gray-400 italic">Not configured</span>
              )}
            </div>
          )}
        </div>
        {googleConnected && googleEmail && (
          <p className="text-xs text-gray-500 mt-3">Connected as {googleEmail}</p>
        )}
        {!googleConnected && (
          <p className="text-xs text-gray-400 mt-3">
            Connect to automatically schedule interviews directly from the chat assistant
          </p>
        )}
      </div>

      {/* Notifications */}
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 pb-24 sm:pb-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Notifications</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Daily match emails</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Get an email when new jobs are found</p>
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
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={
      <div className="max-w-lg mx-auto space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl h-24 animate-pulse" />
        ))}
      </div>
    }>
      <ProfileContent />
    </Suspense>
  );
}
