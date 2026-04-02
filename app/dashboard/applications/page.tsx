"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Application {
  id: string;
  status: string;
  applied_at: string;
  cover_letter: string | null;
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
  failed:       "bg-red-50 text-red-400",
};

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

  const counts = {
    applied:      apps.filter((a) => a.status === "applied").length,
    interviewing: apps.filter((a) => a.status === "interviewing").length,
    offer:        apps.filter((a) => a.status === "offer").length,
    rejected:     apps.filter((a) => a.status === "rejected").length,
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">My Applications</h1>
        <p className="text-sm text-gray-500 mt-0.5">Track and manage your job applications</p>
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
            <div key={i} className="bg-white border rounded-xl h-14 animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && apps.length === 0 && (
        <div className="bg-white border rounded-xl p-12 text-center text-gray-500 text-sm">
          No applications yet.{" "}
          <Link href="/dashboard" className="text-blue-600 hover:underline">
            Browse matched jobs
          </Link>
        </div>
      )}

      {!loading && !error && apps.length > 0 && (
        <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Company</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Applied</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {apps.map((app) => (
                <tr key={app.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 max-w-[160px] truncate">
                    {app.company}
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">
                    {app.job_title}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
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
                      {ALLOWED_STATUSES.map((s) => (
                        <option key={s} value={s} className="bg-white text-gray-800 font-normal">
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {app.status === "manual" ? (
                        <a
                          href={app.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Apply now →
                        </a>
                      ) : (
                        <a
                          href={app.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-medium"
                        >
                          View job ↗
                        </a>
                      )}
                      <button
                        onClick={() => handleDelete(app.id)}
                        disabled={deleting === app.id}
                        className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
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
