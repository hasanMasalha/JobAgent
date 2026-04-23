"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import JobCard, { Job } from "./JobCard";
import JobFilters, { DEFAULT_FILTERS, Filters } from "@/app/components/JobFilters";

function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function jobScore(job: Job): number {
  return job.claude_score > 0 ? job.claude_score : Math.round(job.similarity * 100);
}

function workTypeMatch(job: Job, workTypes: Filters["workTypes"]): boolean {
  if (workTypes.length === 0) return true;
  const loc = (job.location ?? "").toLowerCase();
  const desc = (job.description ?? "").toLowerCase();
  const text = loc + " " + desc;
  return workTypes.some((w) => {
    if (w === "remote") return text.includes("remote") || text.includes("מרחוק");
    if (w === "hybrid") return text.includes("hybrid") || text.includes("היברידי");
    if (w === "onsite") return (
      text.includes("on-site") || text.includes("onsite") ||
      text.includes("office") || text.includes("in-person") ||
      (!text.includes("remote") && !text.includes("hybrid"))
    );
    return true;
  });
}

function jobTypeMatch(job: Job, jobTypes: Filters["jobTypes"]): boolean {
  if (jobTypes.length === 0) return true;
  const text = ((job.title ?? "") + " " + (job.description ?? "")).toLowerCase();
  return jobTypes.some((t) => {
    if (t === "full-time") return text.includes("full-time") || text.includes("full time") || text.includes("משרה מלאה");
    if (t === "part-time") return text.includes("part-time") || text.includes("part time") || text.includes("משרה חלקית");
    if (t === "contract") return text.includes("contract") || text.includes("freelance") || text.includes("קבלן");
    return true;
  });
}

function dateMatch(job: Job, daysPosted: Filters["daysPosted"]): boolean {
  if (daysPosted === "any") return true;
  const days = parseInt(daysPosted);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(job.scraped_at).getTime() >= cutoff;
}

function salaryMatch(job: Job, minSalary: string): boolean {
  if (!minSalary) return true;
  const min = parseInt(minSalary);
  if (isNaN(min)) return true;
  // Jobs with no salary data are always shown
  if (job.salary_max == null && job.salary_min == null) return true;
  const best = job.salary_max ?? job.salary_min ?? 0;
  return best >= min;
}

function applySort(jobs: Job[], sortBy: Filters["sortBy"]): Job[] {
  const arr = [...jobs];
  if (sortBy === "score") {
    arr.sort((a, b) => jobScore(b) - jobScore(a));
  } else if (sortBy === "newest") {
    arr.sort((a, b) => new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime());
  } else if (sortBy === "salary") {
    arr.sort((a, b) => {
      const sa = a.salary_max ?? a.salary_min ?? -1;
      const sb = b.salary_max ?? b.salary_min ?? -1;
      return sb - sa;
    });
  }
  return arr;
}

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const router = useRouter();

  // Re-render every minute so "X minutes ago" stays live
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchJobs = useCallback(async (isRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const [matchRes, savedRes] = await Promise.all([
        fetch(`/api/match${isRefresh ? "?refresh=true" : ""}`),
        fetch("/api/jobs/saved"),
      ]);
      const matchData = await matchRes.json();
      if (!matchRes.ok) throw new Error(matchData.error ?? "Failed to load jobs");
      setJobs(matchData.jobs);
      setLastFetched(new Date());
      if (savedRes.ok) {
        const savedData = await savedRes.json();
        setSavedIds(new Set((savedData.jobs ?? []).map((j: { id: string }) => j.id)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  // Guard: redirect to onboarding if no CV uploaded yet
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (!d.cv) router.replace("/dashboard/onboarding");
        else fetchJobs();
      })
      .catch(() => fetchJobs());
  }, [router, fetchJobs]);

  const filteredJobs = useMemo(() => {
    const filtered = jobs
      .filter((job) => workTypeMatch(job, filters.workTypes))
      .filter((job) => jobTypeMatch(job, filters.jobTypes))
      .filter((job) => dateMatch(job, filters.daysPosted))
      .filter((job) => salaryMatch(job, filters.minSalary));
    return applySort(filtered, filters.sortBy);
  }, [jobs, filters]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Matched Jobs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Top matches based on your CV</p>
        </div>
        <div className="flex items-center gap-3">
          {lastFetched && !loading && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              Last updated: {timeAgo(lastFetched)}
            </span>
          )}
          <button
            onClick={() => fetchJobs(true)}
            disabled={loading}
            className="text-sm font-medium px-3 py-1.5 border rounded-lg hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <JobFilters
        filters={filters}
        onChange={setFilters}
        matchCount={!loading && !error && jobs.length > 0 ? filteredJobs.length : undefined}
        totalCount={!loading && !error && jobs.length > 0 ? jobs.length : undefined}
      />

      <div className="mt-4">

        {loading && (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-2" />
                <div className="h-3 bg-gray-100 dark:bg-gray-600 rounded w-1/3 mb-4" />
                <div className="h-3 bg-gray-100 dark:bg-gray-600 rounded w-full mb-1" />
                <div className="h-3 bg-gray-100 dark:bg-gray-600 rounded w-4/5" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-5 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && jobs.length === 0 && (
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-10 text-center">
            <p className="text-gray-700 dark:text-gray-300 font-medium">No new matches today.</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Check back tomorrow or{" "}
              <a href="/dashboard/onboarding" className="text-blue-600 dark:text-blue-400 hover:underline">
                update your preferences
              </a>
              .
            </p>
          </div>
        )}

        {!loading && !error && jobs.length > 0 && filteredJobs.length === 0 && (
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-10 text-center">
            <p className="text-gray-700 dark:text-gray-300 font-medium">No jobs match your filters.</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Try adjusting the filters above.
            </p>
          </div>
        )}

        {!loading && !error && filteredJobs.length > 0 && (
          <div className="space-y-4">
            {filteredJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                initialSaved={savedIds.has(job.id)}
                onDismiss={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
