"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { showToast } from "@/app/components/Toast";
import {
  Badge,
  Button,
  DocumentIcon,
  Field,
  Input,
  Notice,
  PageHero,
  RemovableTag,
  Select,
  Skeleton,
  UploadIcon,
  chipStyles,
} from "@/app/components/ui";
import { cn } from "@/lib/cn";

// The LinkedIn connection section is hidden until it's ready for launch.
// While it is, don't run its check either: /api/linkedin/session-status
// starts a Playwright session validation on the AI service (5-10 s).
const LINKEDIN_SECTION_ENABLED = false;

interface Profile {
  cv: { clean_summary: string | null; skills_json: string | null; updated_at: string } | null;
  preferences: { titles: string[]; locations: string[]; remote_ok: boolean; work_modes: string[]; min_salary: number | null } | null;
}

interface EasyApplyDefaults {
  first_name: string;
  last_name: string;
  phone: string;
  city: string;
  currentCompany: string;
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;
  expected_salary: string;
  notice_period: string;
  years_of_experience: string;
  highest_education: string;
  work_authorized: boolean;
  requires_sponsorship: boolean;
  willing_to_relocate: boolean;
}

interface SavedAnswer {
  id: string;
  question: string;
  answer: string;
  updated_at: string;
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

  // Easy Apply defaults
  const [defaults, setDefaults] = useState<EasyApplyDefaults>({
    first_name: "", last_name: "", phone: "", city: "", currentCompany: "",
    linkedin_url: "", github_url: "", portfolio_url: "",
    expected_salary: "", notice_period: "30", years_of_experience: "2",
    highest_education: "Bachelor's Degree",
    work_authorized: true, requires_sponsorship: false, willing_to_relocate: false,
  });
  const [savingDefaults, setSavingDefaults] = useState(false);

  // Saved answers (learned from previous Easy Apply sessions)
  const [savedAnswers, setSavedAnswers] = useState<SavedAnswer[]>([]);
  const [editingAnswer, setEditingAnswer] = useState<{ id: string; value: string } | null>(null);

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
  const [linkedinChecking, setLinkedinChecking] = useState(LINKEDIN_SECTION_ENABLED);
  const [linkedinConnecting, setLinkedinConnecting] = useState(false);
  const [linkedinModal, setLinkedinModal] = useState(false);
  const [linkedinCookie, setLinkedinCookie] = useState("");
  const [linkedinError, setLinkedinError] = useState("");

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data: Profile & { email_notifications?: boolean } & EasyApplyDefaults) => {
        setProfile(data);
        if (typeof data.email_notifications === "boolean") {
          setEmailNotifications(data.email_notifications);
        }
        setDefaults({
          first_name: data.first_name ?? "",
          last_name: data.last_name ?? "",
          phone: data.phone ?? "",
          city: data.city ?? "",
          currentCompany: data.currentCompany ?? "",
          linkedin_url: data.linkedin_url ?? "",
          github_url: data.github_url ?? "",
          portfolio_url: data.portfolio_url ?? "",
          expected_salary: data.expected_salary ?? "",
          notice_period: data.notice_period ?? "30",
          years_of_experience: data.years_of_experience ?? "2",
          highest_education: data.highest_education ?? "Bachelor's Degree",
          work_authorized: data.work_authorized ?? true,
          requires_sponsorship: data.requires_sponsorship ?? false,
          willing_to_relocate: data.willing_to_relocate ?? false,
        });
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

    // Load saved Easy Apply answers
    fetch("/api/apply/answers")
      .then((r) => r.json())
      .then((d) => { if (d.answers) setSavedAnswers(d.answers); })
      .catch(() => {});

    // Check LinkedIn session status on mount — real Playwright validation (5-10 s)
    if (LINKEDIN_SECTION_ENABLED) {
      fetch("/api/linkedin/session-status")
        .then((r) => r.json())
        .then((d) => { setLinkedinConnected(!!d.connected); })
        .catch(() => {})
        .finally(() => setLinkedinChecking(false));
    }

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

  // Auto-unsubscribe when ?unsubscribe=true
  useEffect(() => {
    if (searchParams.get("unsubscribe") === "true" && !loading) {
      handleEmailToggle(false);
      showToast("You've been unsubscribed from daily emails.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function handleConnectLinkedin() {
    setLinkedinError("");
    setLinkedinCookie("");
    setLinkedinModal(true);
  }

  async function handleSubmitLinkedinCookie() {
    if (!linkedinCookie.trim()) {
      setLinkedinError("Please paste your li_at cookie value.");
      return;
    }
    setLinkedinError("");
    setLinkedinConnecting(true);
    try {
      const res = await fetch("/api/linkedin/start-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: linkedinCookie.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to connect");
      setLinkedinConnected(true);
      setLinkedinModal(false);
      setLinkedinCookie("");
      showToast("LinkedIn connected!", "success");
    } catch (err) {
      setLinkedinError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLinkedinConnecting(false);
    }
  }

  async function handleDeleteAnswer(question: string) {
    try {
      await fetch("/api/apply/answers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      setSavedAnswers((prev) => prev.filter((a) => a.question !== question));
      showToast("Answer deleted", "success");
    } catch {
      showToast("Failed to delete answer", "error");
    }
  }

  async function handleSaveEditedAnswer(question: string, answer: string) {
    try {
      await fetch("/api/apply/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer }),
      });
      setSavedAnswers((prev) =>
        prev.map((a) => a.question === question ? { ...a, answer } : a)
      );
      setEditingAnswer(null);
      showToast("Answer saved", "success");
    } catch {
      showToast("Failed to save answer", "error");
    }
  }

  async function handleSaveDefaults() {
    setSavingDefaults(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(defaults),
      });
      if (!res.ok) throw new Error("Failed to save");
      showToast("Auto Apply defaults saved", "success");
    } catch {
      showToast("Failed to save defaults", "error");
    } finally {
      setSavingDefaults(false);
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
    setLinkedinConnecting(false);
    setLinkedinModal(false);
    setLinkedinError("");
    setLinkedinCookie("");
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

  if (loading) return <ProfileSkeleton />;

  const cvUpdated = profile?.cv
    ? new Date(profile.cv.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="w-full">
      {/* LinkedIn cookie modal */}
      {linkedinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Connect LinkedIn</h2>

            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-4">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                How to get your LinkedIn cookie:
              </p>
              <ol className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-decimal list-inside">
                <li>Open <strong>LinkedIn.com</strong> and make sure you&apos;re logged in</li>
                <li>Press <strong>F12</strong> to open Developer Tools</li>
                <li>Click the <strong>Application</strong> tab (Chrome) or <strong>Storage</strong> tab (Firefox)</li>
                <li>Expand <strong>Cookies</strong> → click <strong>https://www.linkedin.com</strong></li>
                <li>Find the cookie named <strong>li_at</strong></li>
                <li>Copy the entire <strong>Value</strong> column</li>
                <li>Paste it in the field below</li>
              </ol>
            </div>

            <textarea
              value={linkedinCookie}
              onChange={(e) => setLinkedinCookie(e.target.value)}
              placeholder="Paste your li_at cookie value here…"
              className="w-full h-24 border dark:border-gray-600 rounded-lg p-3 text-sm font-mono resize-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              disabled={linkedinConnecting}
            />

            {linkedinError && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-3">{linkedinError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={cancelLinkedinConnect}
                disabled={linkedinConnecting}
                className="flex-1 border dark:border-gray-600 rounded-lg py-2 text-sm dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitLinkedinCookie}
                disabled={linkedinConnecting || !linkedinCookie.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-50"
              >
                {linkedinConnecting ? "Connecting…" : "Connect LinkedIn"}
              </button>
            </div>
          </div>
        </div>
      )}

      <PageHero
        title="Your profile"
        subtitle="Your CV, the jobs you want, and the details JobAgent fills into applications for you."
      />

      <div className="relative mx-auto -mt-14 max-w-3xl space-y-6 pb-24 sm:-mt-16 sm:pb-10">
        <form onSubmit={handleSave} className="space-y-6">
          {/* ── Your CV ── */}
          <section aria-labelledby="cv-heading" className={cardCls}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="cv-heading" className={sectionHeading}>Your CV</h2>
              {cvUpdated && <p className="text-body-sm text-ink-subtle">Last updated {cvUpdated}</p>}
            </div>

            {profile?.cv && (
              <div className="mt-5">
                {profile.cv.clean_summary && (
                  <p className="line-clamp-3 text-body text-ink-muted">{profile.cv.clean_summary}</p>
                )}
                {skills.length > 0 && (
                  <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Skills from your CV">
                    {skills.slice(0, 12).map((s: string) => (
                      <li key={s}><Badge>{s}</Badge></li>
                    ))}
                    {skills.length > 12 && (
                      <li className="self-center text-caption text-ink-subtle">+{skills.length - 12} more</li>
                    )}
                  </ul>
                )}
                <Link href="/dashboard/my-cv" className={cn(textLink, "mt-4 inline-block")}>
                  View your full CV →
                </Link>
              </div>
            )}

            <div className="mt-6">
              <p className="text-body-sm font-medium text-ink">{profile?.cv ? "Replace your CV" : "Upload your CV"}</p>
              <label
                className={cn(
                  "mt-2 flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed px-6 py-7 text-center transition-colors",
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
                <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand-text">
                  {file ? <DocumentIcon className="h-5 w-5" /> : <UploadIcon className="h-5 w-5" />}
                </span>
                {file ? (
                  <>
                    <span className="text-body-sm font-semibold text-ink">{file.name}</span>
                    <span className="text-caption text-ink-subtle">Replaces your current CV when you save</span>
                  </>
                ) : (
                  <>
                    <span className="text-body-sm font-medium text-ink">Choose a PDF or Word file</span>
                    <span className="text-caption text-ink-subtle">.pdf or .docx, up to 5 MB</span>
                  </>
                )}
              </label>
            </div>
          </section>

          {/* ── What you're looking for ── */}
          <section aria-labelledby="prefs-heading" className={cardCls}>
            <h2 id="prefs-heading" className={sectionHeading}>What you&apos;re looking for</h2>
            <p className="mt-1.5 text-body-sm text-ink-muted">Used to find and filter your matches.</p>

            <div className="mt-6 space-y-5">
              <Field id="profile-title" label="Job titles">
                <div className="flex gap-2">
                  <Input
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTitle(); } }}
                    placeholder="e.g. Frontend Developer"
                  />
                  <Button type="button" variant="secondary" onClick={addTitle}>Add</Button>
                </div>
              </Field>
              {titles.length > 0 && (
                <div className="-mt-2 flex flex-wrap gap-2">
                  {titles.map((t) => (
                    <RemovableTag key={t} label={t} onRemove={() => setTitles(titles.filter((x) => x !== t))} />
                  ))}
                </div>
              )}

              <Field id="profile-location" label="Location">
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Tel Aviv" />
              </Field>

              <fieldset>
                <legend className="text-body-sm font-medium text-ink">Work mode</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {["Remote", "Hybrid", "On-site"].map((mode) => {
                    const on = workModes.includes(mode);
                    return (
                      <button key={mode} type="button" aria-pressed={on} onClick={() => toggleWorkMode(mode)} className={chipStyles({ selected: on })}>
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="profile-salary" className="text-body-sm font-medium text-ink">Minimum salary</label>
                  <button
                    type="button"
                    onClick={() => { setSkipSalary((v) => !v); setMinSalary(""); }}
                    className={cn(textLink, "text-body-sm")}
                  >
                    {skipSalary ? "Add salary" : "Skip salary"}
                  </button>
                </div>
                {skipSalary ? (
                  <p className="mt-1.5 text-body-sm italic text-ink-subtle">No minimum salary set</p>
                ) : (
                  <Input
                    id="profile-salary"
                    type="number"
                    className="mt-1.5"
                    value={minSalary}
                    onChange={(e) => setMinSalary(e.target.value)}
                    placeholder="e.g. 15000"
                  />
                )}
              </div>
            </div>

            {error && <Notice tone="danger" className="mt-5">{error}</Notice>}

            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" size="lg" onClick={() => router.push("/dashboard")}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={saving || titles.length === 0} loading={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </section>
        </form>
        {/* LinkedIn Connection — hidden from UI, not ready for launch (LINKEDIN_SECTION_ENABLED). */}
        {LINKEDIN_SECTION_ENABLED && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">LinkedIn Connection</h2>
              <p className="text-xs text-gray-500 mt-0.5">Required for Easy Apply automation</p>
            </div>
            {/* Desktop: badge + button inline */}
            {linkedinChecking ? (
              <span className="hidden sm:inline text-xs text-gray-400 italic">Verifying LinkedIn connection…</span>
            ) : linkedinConnected ? (
              <div className="hidden sm:flex items-center gap-3">
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
              <div className="hidden sm:flex items-center gap-3">
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
            <p className="sm:hidden text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
              Easy Apply won&apos;t work until LinkedIn is connected. Click Connect and log in when the browser opens.
            </p>
          )}
          {/* Mobile: badge + button last */}
          {linkedinChecking ? (
            <span className="flex sm:hidden text-xs text-gray-400 italic mt-3">Verifying LinkedIn connection…</span>
          ) : linkedinConnected ? (
            <div className="flex sm:hidden items-center gap-3 justify-end mt-3">
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
            <div className="flex sm:hidden items-center gap-3 justify-end mt-3">
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
        )}

        {/* Google Calendar Connection — hidden from UI, not ready for launch. Backend/state untouched. */}
        {false && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Google Calendar</h2>
              <p className="text-xs text-gray-500 mt-0.5">For scheduling interviews from the chat assistant</p>
            </div>
            {/* Desktop: badge + button inline */}
            {googleConnected ? (
              <div className="hidden sm:flex items-center gap-3">
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
              <div className="hidden sm:flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full">
                  Not connected
                </span>
                {googleConfigured ? (
                  <a
                    href="/api/auth/google"
                    className="text-xs font-semibold bg-black dark:bg-white dark:text-black text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors whitespace-nowrap"
                  >
                    Connect Google Calendar
                  </a>
                ) : (
                  <button
                    disabled
                    title="Google Calendar integration is not configured on this server"
                    className="text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-600 px-3 py-1.5 rounded-lg cursor-not-allowed whitespace-nowrap"
                  >
                    Connect Google Calendar
                  </button>
                )}
              </div>
            )}
          </div>
          {googleConnected && googleEmail && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">Connected as {googleEmail}</p>
          )}
          {!googleConnected && (
            <p className="sm:hidden text-xs text-gray-400 mt-3">
              Connect to automatically schedule interviews directly from the chat assistant
            </p>
          )}
          {/* Mobile: badge + button last */}
          {googleConnected ? (
            <div className="flex sm:hidden items-center gap-3 justify-end mt-3">
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
            <div className="flex sm:hidden items-center gap-3 justify-end mt-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full">
                Not connected
              </span>
              {googleConfigured ? (
                <a
                  href="/api/auth/google"
                  className="text-xs font-semibold bg-black dark:bg-white dark:text-black text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors whitespace-nowrap"
                >
                  Connect Google Calendar
                </a>
              ) : (
                <button
                  disabled
                  title="Google Calendar integration is not configured on this server"
                  className="text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-600 px-3 py-1.5 rounded-lg cursor-not-allowed whitespace-nowrap"
                >
                  Connect Google Calendar
                </button>
              )}
            </div>
          )}
        </div>
        )}

        {/* ── Application details (Easy Apply defaults) ── */}
        <section aria-labelledby="details-heading" className={cardCls}>
          <h2 id="details-heading" className={sectionHeading}>Application details</h2>
          <p className="mt-1.5 text-body-sm text-ink-muted">JobAgent fills these into application forms when it applies for you.</p>

          <div className="mt-6 space-y-7">
            <div>
              <h3 className={groupLabel}>Contact</h3>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {([
                  { label: "First name", key: "first_name", placeholder: "", type: "text" },
                  { label: "Last name", key: "last_name", placeholder: "", type: "text" },
                  { label: "Phone", key: "phone", placeholder: "+972-50-000-0000", type: "tel" },
                  { label: "City", key: "city", placeholder: "e.g. Tel Aviv, New York, London", type: "text" },
                ] as const).map(({ label, key, placeholder, type }) => (
                  <Field key={key} id={`default-${key}`} label={label}>
                    <Input
                      type={type}
                      value={defaults[key]}
                      onChange={(e) => setDefaults({ ...defaults, [key]: e.target.value })}
                      placeholder={placeholder || undefined}
                    />
                  </Field>
                ))}
              </div>
            </div>

            <div>
              <h3 className={groupLabel}>Experience</h3>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="default-currentCompany" label="Current or most recent company" className="sm:col-span-2">
                  <Input
                    value={defaults.currentCompany}
                    onChange={(e) => setDefaults({ ...defaults, currentCompany: e.target.value })}
                    placeholder="e.g. Google, Self-employed, Student"
                  />
                </Field>
                <Field id="default-years" label="Years of experience">
                  <Input
                    inputMode="numeric"
                    value={defaults.years_of_experience}
                    onChange={(e) => setDefaults({ ...defaults, years_of_experience: e.target.value })}
                    placeholder="2"
                  />
                </Field>
                <Field id="default-education" label="Highest education">
                  <Select
                    value={defaults.highest_education}
                    onChange={(e) => setDefaults({ ...defaults, highest_education: e.target.value })}
                  >
                    {["High School", "Associate's Degree", "Bachelor's Degree", "Master's Degree", "PhD", "Bootcamp / Self-taught"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </Select>
                </Field>
                <Field id="default-salary" label="Expected salary (monthly, NIS)">
                  <Input
                    inputMode="numeric"
                    value={defaults.expected_salary}
                    onChange={(e) => setDefaults({ ...defaults, expected_salary: e.target.value })}
                    placeholder="20000"
                  />
                </Field>
                <Field id="default-notice" label="Notice period (days)">
                  <Input
                    inputMode="numeric"
                    value={defaults.notice_period}
                    onChange={(e) => setDefaults({ ...defaults, notice_period: e.target.value })}
                    placeholder="30"
                  />
                </Field>
              </div>
            </div>

            <div>
              <h3 className={groupLabel}>Links</h3>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {([
                  { label: "LinkedIn profile", key: "linkedin_url", placeholder: "https://linkedin.com/in/yourname" },
                  { label: "GitHub", key: "github_url", placeholder: "https://github.com/yourname" },
                  { label: "Portfolio or website", key: "portfolio_url", placeholder: "https://yourwebsite.com" },
                ] as const).map(({ label, key, placeholder }) => (
                  <Field key={key} id={`default-${key}`} label={label}>
                    <Input
                      type="url"
                      value={defaults[key]}
                      onChange={(e) => setDefaults({ ...defaults, [key]: e.target.value })}
                      placeholder={placeholder}
                    />
                  </Field>
                ))}
              </div>
            </div>

            <div>
              <h3 className={groupLabel}>Eligibility</h3>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {([
                  { label: "Authorized to work in Israel?", key: "work_authorized", yesFirst: true },
                  { label: "Requires visa sponsorship?", key: "requires_sponsorship", yesFirst: false },
                  { label: "Willing to relocate?", key: "willing_to_relocate", yesFirst: true },
                ] as const).map(({ label, key, yesFirst }) => (
                  <fieldset key={key}>
                    <legend className="text-body-sm font-medium text-ink">{label}</legend>
                    <div className="mt-2 inline-flex rounded-control border border-line-strong bg-surface-sunken p-0.5">
                      {(yesFirst ? [true, false] : [false, true]).map((val) => {
                        const on = defaults[key] === val;
                        return (
                          <label
                            key={String(val)}
                            className={cn(
                              "cursor-pointer rounded-[0.4rem] px-4 py-1.5 text-body-sm transition-colors",
                              "focus-within:ring-2 focus-within:ring-ring",
                              on ? "bg-brand font-semibold text-brand-on shadow-sm" : "text-ink-muted hover:text-ink",
                            )}
                          >
                            <input
                              type="radio"
                              name={`default-${key}`}
                              className="sr-only"
                              checked={on}
                              onChange={() => setDefaults({ ...defaults, [key]: val })}
                            />
                            {val ? "Yes" : "No"}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 flex sm:justify-end">
            <Button type="button" size="lg" className="w-full sm:w-auto" onClick={handleSaveDefaults} disabled={savingDefaults} loading={savingDefaults}>
              {savingDefaults ? "Saving…" : "Save application details"}
            </Button>
          </div>
        </section>

        {/* ── Saved answers ── */}
        <section aria-labelledby="answers-heading" className={cardCls}>
          <h2 id="answers-heading" className={sectionHeading}>Saved answers</h2>
          <p className="mt-1.5 text-body-sm text-ink-muted">
            Answers you gave to questions the extension didn&apos;t recognise. It reuses them on later applications.
          </p>

          {savedAnswers.length === 0 ? (
            <p className="mt-5 rounded-card bg-surface-sunken px-4 py-5 text-center text-body-sm text-ink-subtle">
              Nothing saved yet. When an application asks something new, your answer is kept here.
            </p>
          ) : (
            <ul className="mt-5 divide-y divide-line">
              {savedAnswers.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-caption font-medium text-ink-subtle">{a.question}</p>
                    {editingAnswer?.id === a.id ? (
                      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                        <Input
                          aria-label={`Answer to: ${a.question}`}
                          value={editingAnswer.value}
                          onChange={(e) => setEditingAnswer({ ...editingAnswer, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEditedAnswer(a.question, editingAnswer.value);
                            if (e.key === "Escape") setEditingAnswer(null);
                          }}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleSaveEditedAnswer(a.question, editingAnswer.value)}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingAnswer(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-body text-ink">{a.answer}</p>
                    )}
                  </div>
                  {editingAnswer?.id !== a.id && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditingAnswer({ id: a.id, value: a.answer })}>Edit</Button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAnswer(a.question)}
                        className="inline-flex h-8 items-center rounded-control px-3 text-body-sm font-semibold text-danger-text transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Notifications ── */}
        <section aria-labelledby="notif-heading" className={cardCls}>
          <h2 id="notif-heading" className={sectionHeading}>Notifications</h2>
          <div className="mt-5 flex items-center justify-between gap-4">
            <div>
              <p id="daily-email-label" className="text-body font-medium text-ink">Daily match emails</p>
              <p className="mt-0.5 text-body-sm text-ink-muted">An email when new jobs match your profile.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={emailNotifications}
              aria-labelledby="daily-email-label"
              onClick={() => handleEmailToggle(!emailNotifications)}
              disabled={savingEmail}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                emailNotifications ? "bg-brand" : "bg-line-strong",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block h-4 w-4 rounded-full bg-surface shadow transition-transform",
                  emailNotifications ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

const cardCls = "rounded-[1.375rem] bg-surface-raised p-5 shadow-dossier ring-1 ring-line/60 sm:p-8";
const sectionHeading = "font-serif text-feature-sm text-ink";
const groupLabel = "text-caption font-semibold uppercase tracking-wide text-ink-subtle";
const textLink = "font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

function ProfileSkeleton() {
  return (
    <div className="w-full" aria-busy="true">
      <PageHero title="Your profile" subtitle="Your CV, the jobs you want, and the details JobAgent fills into applications for you." />
      <div className="relative mx-auto -mt-14 max-w-3xl space-y-6 sm:-mt-16">
        {[0, 1, 2].map((i) => (
          <div key={i} className={cardCls}>
            <Skeleton className="h-7 w-1/3" />
            <Skeleton className="mt-5 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-4/5" />
            <Skeleton className="mt-6 h-10 w-full" />
          </div>
        ))}
        <span className="sr-only">Loading your profile</span>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfileContent />
    </Suspense>
  );
}
