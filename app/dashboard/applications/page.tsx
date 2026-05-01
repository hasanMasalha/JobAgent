"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

const STATUS_STYLES: Record<string, string> = {
  applied:      "bg-blue-100 text-blue-700",
  interviewing: "bg-purple-100 text-purple-700",
  offer:        "bg-green-100 text-green-800",
  rejected:     "bg-red-100 text-red-600",
  draft:        "bg-gray-100 text-gray-500",
  manual:       "bg-yellow-100 text-yellow-700",
  cancelled:    "bg-gray-100 text-gray-400",
  failed:       "bg-orange-100 text-orange-600",
};

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
          Schedule interview on Google Calendar
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          {app.job_title} at {app.company}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Interview date
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Interview time
            </label>
            <input
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Zoom link, interviewer name…"
              rows={3}
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border dark:border-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Skip
            </button>
            <button
              type="submit"
              disabled={loading || !date}
              className="flex-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Adding…" : "Add to Calendar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className={`flex flex-col items-center px-5 py-3 rounded-xl border ${color}`}>
      <span className="text-2xl font-bold">{count}</span>
      <span className="text-xs font-medium mt-0.5 uppercase tracking-wide">{label}</span>
    </div>
  );
}

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
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

      if (newStatus === "interviewing") {
        const app = apps.find((a) => a.id === id);
        if (app) setCalendarModal({ ...app, status: newStatus });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdating(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this application? This cannot be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/applications/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete");
      }
      setApps((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
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
      alert(err instanceof Error ? err.message : "Download failed");
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

  return (
    <div className="max-w-5xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-5 py-3 rounded-xl shadow-lg flex items-center gap-3">
          <span>{toast.message}</span>
          {toast.url && (
            <a
              href={toast.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium whitespace-nowrap"
            >
              View event →
            </a>
          )}
          <button onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Calendar modal */}
      {calendarModal && (
        <CalendarModal
          app={calendarModal}
          onClose={() => setCalendarModal(null)}
          onSuccess={(eventUrl) => {
            setCalendarModal(null);
            setToast({ message: "Interview added to Google Calendar!", url: eventUrl });
          }}
        />
      )}

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">My Applications</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track and manage your job applications</p>
      </div>

      {/* Stats bar */}
      {!loading && !error && (
        <div className="grid grid-cols-4 gap-3 mb-7">
          <StatPill label="Applied"      count={counts.applied}      color="border-blue-200 bg-blue-50 text-blue-700" />
          <StatPill label="Interviewing" count={counts.interviewing} color="border-purple-200 bg-purple-50 text-purple-700" />
          <StatPill label="Offers"       count={counts.offer}        color="border-green-200 bg-green-50 text-green-700" />
          <StatPill label="Rejected"     count={counts.rejected}     color="border-red-200 bg-red-50 text-red-600" />
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl h-14 animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-5 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && !error && apps.length === 0 && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-12 text-center text-gray-500 dark:text-gray-400 text-sm">
          No applications yet.{" "}
          <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline">
            Browse matched jobs
          </Link>
        </div>
      )}

      {!loading && !error && apps.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Company</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Applied</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {apps.map((app) => (
                <tr key={app.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white max-w-[160px] truncate">
                    {app.company}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[200px] truncate">
                    {app.job_title}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {new Date(app.applied_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={ALLOWED_STATUSES.includes(app.status as AllowedStatus) ? app.status : ""}
                      disabled={updating === app.id}
                      onChange={(e) =>
                        handleStatusChange(app.id, e.target.value as AllowedStatus)
                      }
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-400 disabled:opacity-50 ${
                        STATUS_STYLES[app.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {app.status === "manual" && (
                        <option value="" disabled className="bg-white text-gray-400 font-normal">
                          Action needed — update after applying
                        </option>
                      )}
                      {app.status === "failed" && (
                        <option value="" disabled className="bg-white text-gray-400 font-normal">
                          Manual apply needed
                        </option>
                      )}
                      {ALLOWED_STATUSES.map((s) => (
                        <option key={s} value={s} className="bg-white text-gray-800 font-normal">
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {app.status === "manual" || app.status === "failed" ? (
                        <a
                          href={app.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white w-28 h-9 px-3 py-2 rounded-lg transition-colors text-center"
                        >
                          Apply now →
                        </a>
                      ) : (
                        <a
                          href={app.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white w-28 h-9 px-3 py-2 rounded-lg transition-colors text-center"
                        >
                          View job ↗
                        </a>
                      )}
                      {app.has_tailored_cv && (
                        <>
                          <span className="text-gray-200 dark:text-gray-600 select-none">|</span>
                          <button
                            onClick={() => handleDownloadCV(app.id)}
                            disabled={downloading === app.id}
                            className="text-emerald-600 hover:text-emerald-700 font-medium disabled:opacity-50 transition-colors whitespace-nowrap"
                            title="Download tailored CV"
                          >
                            {downloading === app.id ? "…" : "CV ↓"}
                          </button>
                        </>
                      )}
                      <span className="text-gray-200 dark:text-gray-600 select-none">|</span>
                      <button
                        onClick={() => handleDelete(app.id)}
                        disabled={deleting === app.id}
                        className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50 whitespace-nowrap"
                        title="Delete application"
                      >
                        {deleting === app.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
