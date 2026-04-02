"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import JobCard, { Job } from "./JobCard";

function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const router = useRouter();

  // Re-render every minute so "X minutes ago" stays live
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/match");
      const data = await res.json();
      if (!res.ok) {
        const msg: string = data.error ?? "Failed to load jobs";
        // No CV uploaded yet → send to onboarding
        if (msg.toLowerCase().includes("cv not found")) {
          router.replace("/dashboard/onboarding");
          return;
        }
        throw new Error(msg);
      }
      setJobs(data.jobs);
      setLastFetched(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Matched Jobs</h1>
          <p className="text-sm text-gray-500 mt-0.5">Top matches based on your CV</p>
        </div>
        <div className="flex items-center gap-3">
          {lastFetched && !loading && (
            <span className="text-xs text-gray-400">
              Last updated: {timeAgo(lastFetched)}
            </span>
          )}
          <button
            onClick={fetchJobs}
            disabled={loading}
            className="text-sm font-medium px-3 py-1.5 border rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          {!loading && !error && (
            <span className="text-sm text-gray-400">{jobs.length} results</span>
          )}
        </div>
      </div>

      {loading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white border rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/3 mb-4" />
              <div className="h-3 bg-gray-100 rounded w-full mb-1" />
              <div className="h-3 bg-gray-100 rounded w-4/5" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="bg-white border rounded-xl p-10 text-center">
          <p className="text-gray-700 font-medium">No new matches today.</p>
          <p className="text-sm text-gray-500 mt-1">
            Check back tomorrow or{" "}
            <a href="/dashboard/onboarding" className="text-blue-600 hover:underline">
              update your preferences
            </a>
            .
          </p>
        </div>
      )}

      {!loading && !error && jobs.length > 0 && (
        <div className="space-y-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
