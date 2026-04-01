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

const STATUS_STYLES: Record<string, string> = {
  draft:        "bg-gray-100 text-gray-600",
  applied:      "bg-blue-100 text-blue-700",
  manual:       "bg-yellow-100 text-yellow-700",
  interviewing: "bg-purple-100 text-purple-700",
  offer:        "bg-green-100 text-green-800",
  rejected:     "bg-red-100 text-red-600",
  cancelled:    "bg-gray-100 text-gray-400",
  failed:       "bg-red-50 text-red-400",
};

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">My Applications</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track your job applications</p>
        </div>
        {!loading && !error && (
          <span className="text-sm text-gray-400">{apps.length} total</span>
        )}
      </div>

      {loading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white border rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && apps.length === 0 && (
        <div className="bg-white border rounded-xl p-10 text-center text-gray-500 text-sm">
          No applications yet.{" "}
          <Link href="/dashboard" className="text-blue-600 hover:underline">
            Browse matched jobs
          </Link>
        </div>
      )}

      {!loading && !error && apps.length > 0 && (
        <div className="space-y-4">
          {apps.map((app) => (
            <div key={app.id} className="bg-white border rounded-xl p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{app.job_title}</h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {app.company}
                    {app.location ? ` · ${app.location}` : ""}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(app.applied_at).toLocaleDateString("en-GB", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${
                    STATUS_STYLES[app.status] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {app.status === "manual" ? "Apply manually" : app.status}
                </span>
              </div>

              {app.status === "manual" && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                  This job doesn&apos;t support Easy Apply.{" "}
                  <a
                    href={app.job_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline"
                  >
                    Apply directly on the job site →
                  </a>
                </div>
              )}

              <div className="mt-3 flex gap-3">
                <a
                  href={app.job_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  View job
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
