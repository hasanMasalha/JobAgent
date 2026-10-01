"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { showToast } from "@/app/components/Toast";
import {
  Button,
  CloseIcon,
  DownloadIcon,
  Field,
  Input,
  Notice,
  PageHero,
  Skeleton,
  StatePanel,
  Textarea,
  buttonStyles,
  statusSelectStyles,
} from "@/app/components/ui";
import { statusMeta } from "@/lib/application-status";
import { cn } from "@/lib/cn";
import { GOOGLE_CALENDAR_ENABLED } from "@/lib/features";

interface Application {
  id: string;
  status: string;
  applied_at: string;
  cover_letter: string | null;
  has_tailored_cv: boolean;
  job_title: string;
  company: string;
  job_url: string;
  location: string | null;
}

const ALLOWED_STATUSES = ["applied", "interviewing", "offer", "rejected"] as const;
type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

// Legacy statuses (failed, needs_security_code) are shown like needs_manual —
// see lib/application-status.ts.
const MANUAL_STATUSES = new Set(["manual", "failed", "needs_manual", "needs_security_code"]);

// What the user has to do for an application that's waiting on them.
function actionHint(status: string): string | null {
  if (status === "pending_verification") return "Greenhouse emailed you a verification code. Open the job posting and enter the code there to finish applying.";
  if (status === "manual") return "Apply on the company's site, then set the status here.";
  if (MANUAL_STATUSES.has(status)) return "We couldn't finish this one automatically. Check your email for the link to apply yourself.";
  return null;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const cardCls = "rounded-[1.375rem] bg-surface-raised shadow-dossier ring-1 ring-line/60";

interface CalendarModalProps {
  app: Application;
  onClose: () => void;
  onSuccess: (eventUrl: string) => void;
}

function CalendarModal({ app, onClose, onSuccess }: CalendarModalProps) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !loading) onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/calendar/create-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: app.id, date, time, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create event");
      onSuccess(data.eventUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-gutter font-sans">
      <div role="dialog" aria-modal="true" aria-labelledby="calendar-title" className="w-full max-w-md rounded-overlay bg-surface p-6 shadow-overlay">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="calendar-title" className="font-serif text-title-serif text-ink">Add the interview to your calendar</h2>
            <p className="mt-1 text-body-sm text-ink-muted">{app.job_title} at {app.company}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading} aria-label="Close">
            <CloseIcon className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field id="interview-date" label="Date">
              <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="interview-time" label="Time">
              <Input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <Field id="interview-notes" label="Notes" optional>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Zoom link, interviewer name…" className="resize-none" />
          </Field>

          {error && <Notice tone="danger">{error}</Notice>}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Skip</Button>
            <Button type="submit" disabled={loading || !date} loading={loading}>
              {loading ? "Adding…" : "Add to Google Calendar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [calendarModal, setCalendarModal] = useState<Application | null>(null);
  const [toast, setToast] = useState<{ message: string; url?: string } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/applications")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load applications");
        setApps(data.applications);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Auto-dismiss toast after 6 seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleStatusChange(id: string, newStatus: AllowedStatus) {
    setUpdating(id);
    try {
      const res = await fetch(`/api/applications/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to update status");
      }
      setApps((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
      );

      // Offer to add it to Google Calendar — only once Calendar has launched.
      if (newStatus === "interviewing" && GOOGLE_CALENDAR_ENABLED) {
        const app = apps.find((a) => a.id === id);
        if (app) setCalendarModal({ ...app, status: newStatus });
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Update failed", "error");
    } finally {
      setUpdating(null);
    }
  }

  // Two-step delete, like saved searches on the dashboard: the first click
  // arms it, the second deletes; it disarms itself after 3 s.
  async function handleDelete(id: string) {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm((prev) => (prev === id ? null : prev)), 3000);
      return;
    }
    setDeleteConfirm(null);
    setDeleting(id);
    try {
      const res = await fetch(`/api/applications/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete");
      }
      setApps((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed", "error");
    } finally {
      setDeleting(null);
    }
  }

  async function handleDownloadCV(id: string) {
    setDownloading(id);
    try {
      const res = await fetch(`/api/apply/${id}/download-cv`);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("content-disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? "CV_tailored.docx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Download failed", "error");
    } finally {
      setDownloading(null);
    }
  }

  const counts = {
    applied:      apps.filter((a) => a.status === "applied").length,
    interviewing: apps.filter((a) => a.status === "interviewing").length,
    offer:        apps.filter((a) => a.status === "offer").length,
    rejected:     apps.filter((a) => a.status === "rejected").length,
  };
  const needsAction = apps.filter((a) => statusMeta(a.status).needsAction).length;

  // Render helpers, not components: a component defined inside the page is a
  // new type every render, so React would remount the <select> and drop focus.
  function statusSelect(app: Application, className?: string) {
    const allowed = ALLOWED_STATUSES.includes(app.status as AllowedStatus);
    return (
      <select
        aria-label={`Status of ${app.job_title} at ${app.company}`}
        value={allowed ? app.status : ""}
        disabled={updating === app.id}
        onChange={(e) => handleStatusChange(app.id, e.target.value as AllowedStatus)}
        className={cn(statusSelectStyles(app.status), className)}
      >
        {!allowed && <option value="" disabled>{statusMeta(app.status).label}</option>}
        {ALLOWED_STATUSES.map((s) => (
          <option key={s} value={s}>{statusMeta(s).label}</option>
        ))}
      </select>
    );
  }

  function primaryAction(app: Application) {
    const [variant, label] =
      app.status === "pending_verification" ? (["waiting", "Open posting to enter code"] as const)
      : MANUAL_STATUSES.has(app.status) ? (["attention", "Apply manually"] as const)
      : (["secondary", "View job"] as const);
    return (
      <a href={app.job_url} target="_blank" rel="noopener noreferrer" className={buttonStyles({ variant, size: "sm" })}>
        {label} <span aria-hidden="true">↗</span>
      </a>
    );
  }

  function secondaryActions(app: Application) {
    const arming = deleteConfirm === app.id;
    return (
      <>
        {app.has_tailored_cv && (
          <Button variant="ghost" size="sm" onClick={() => handleDownloadCV(app.id)} disabled={downloading === app.id} title="Download the tailored CV sent with this application">
            <DownloadIcon className="h-3.5 w-3.5" />
            {downloading === app.id ? "Preparing…" : "Tailored CV"}
          </Button>
        )}
        <button
          type="button"
          onClick={() => handleDelete(app.id)}
          disabled={deleting === app.id}
          className={cn(
            "inline-flex h-8 items-center rounded-control px-3 text-body-sm font-semibold transition-colors disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            arming ? "bg-danger-soft text-danger-text" : "text-ink-subtle hover:bg-danger-soft hover:text-danger-text",
          )}
        >
          {deleting === app.id ? "Deleting…" : arming ? "Confirm delete" : "Delete"}
        </button>
      </>
    );
  }

  return (
    <div className="w-full">
      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-card bg-ink px-5 py-3 text-body-sm text-surface shadow-overlay">
          <span>{toast.message}</span>
          {toast.url && (
            <a href={toast.url} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold underline underline-offset-4">
              View event
            </a>
          )}
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="ml-1 rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface">
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {calendarModal && (
        <CalendarModal
          app={calendarModal}
          onClose={() => setCalendarModal(null)}
          onSuccess={(eventUrl) => {
            setCalendarModal(null);
            setToast({ message: "Interview added to Google Calendar.", url: eventUrl });
          }}
        />
      )}

      <PageHero
        title="Applications"
        subtitle="Every job you've applied to through JobAgent, and where each one stands."
      >
        {!loading && !error && apps.length > 0 && (
          <dl className="grid grid-cols-3 gap-x-5 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-10">
            {needsAction > 0 && (
              <div>
                <dt className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-on-hero">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
                  Needs your action
                </dt>
                <dd className="numerals mt-1 font-serif text-feature-sm text-on-hero">{needsAction}</dd>
              </div>
            )}
            {([
              ["Applied", counts.applied],
              ["Interviewing", counts.interviewing],
              ["Offers", counts.offer],
              ["Rejected", counts.rejected],
            ] as const).map(([label, n]) => (
              <div key={label}>
                <dt className="text-caption font-semibold uppercase tracking-wide text-on-hero-muted">{label}</dt>
                <dd className="numerals mt-1 font-serif text-feature-sm text-on-hero">{n}</dd>
              </div>
            ))}
          </dl>
        )}
      </PageHero>

      <div className="relative mx-auto -mt-14 max-w-6xl pb-24 sm:-mt-16 sm:pb-10">
        {loading && (
          <div className={cn(cardCls, "divide-y divide-line")} aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 sm:px-6">
                <div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-1/5" /></div>
                <Skeleton className="h-7 w-24 rounded-full" />
              </div>
            ))}
            <span className="sr-only" role="status">Loading your applications</span>
          </div>
        )}

        {error && (
          <StatePanel role="alert" title="Couldn't load your applications">{error}</StatePanel>
        )}

        {!loading && !error && apps.length === 0 && (
          <StatePanel
            title="No applications yet"
            action={<Link href="/dashboard/matches" className={buttonStyles({ size: "lg" })}>See your matches</Link>}
          >
            When you apply to a job, it shows up here so you can follow it through to an offer.
          </StatePanel>
        )}

        {!loading && !error && apps.length > 0 && (
          <>
            {/* Phones: one card per application */}
            <ul className="space-y-3 sm:hidden">
              {apps.map((app) => {
                const hint = actionHint(app.status);
                return (
                  <li key={app.id} className={cn(cardCls, "p-4")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="line-clamp-2 break-words text-body font-semibold text-ink">{app.job_title}</p>
                        <p className="truncate text-body-sm text-ink-muted">{app.company}</p>
                      </div>
                      {statusSelect(app, "shrink-0")}
                    </div>
                    {hint && <p className="mt-3 text-body-sm text-ink-muted">{hint}</p>}
                    <p className="mt-2 text-caption text-ink-subtle">Applied {formatDate(app.applied_at)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {primaryAction(app)}
                      <div className="ml-auto flex items-center gap-1">{secondaryActions(app)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Tablet and up: a table */}
            <div className={cn(cardCls, "hidden overflow-hidden sm:block")}>
              <div className="overflow-x-auto">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-caption font-semibold uppercase tracking-wide text-ink-subtle">
                      <th scope="col" className="px-6 py-3.5">Role</th>
                      <th scope="col" className="px-4 py-3.5">Applied</th>
                      <th scope="col" className="px-4 py-3.5">Status</th>
                      <th scope="col" className="px-6 py-3.5 text-right"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {apps.map((app) => {
                      const hint = actionHint(app.status);
                      return (
                        <tr key={app.id} className="align-top transition-colors hover:bg-surface-sunken/50">
                          <td className="max-w-[26rem] px-6 py-4">
                            <p className="truncate font-semibold text-ink">{app.job_title}</p>
                            <p className="truncate text-ink-muted">{app.company}</p>
                            {hint && <p className="mt-1.5 text-caption text-ink-muted">{hint}</p>}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-ink-muted tabular-nums">{formatDate(app.applied_at)}</td>
                          <td className="px-4 py-4">{statusSelect(app)}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-1.5">
                              {secondaryActions(app)}
                              {primaryAction(app)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
