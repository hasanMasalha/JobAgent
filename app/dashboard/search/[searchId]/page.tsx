"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import JobCard, { Job } from "@/app/dashboard/JobCard";
import { LOCATIONS, SENIORITY_LEVELS } from "@/lib/job-categories";

interface SearchMeta {
  id: string;
  category: string;
  keywords: string[];
  locations: string[];
  seniorities: string[];
}

function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-5 animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-2" />
      <div className="h-3 bg-gray-100 dark:bg-gray-600 rounded w-1/3 mb-4" />
      <div className="h-3 bg-gray-100 dark:bg-gray-600 rounded w-full mb-1" />
      <div className="h-3 bg-gray-100 dark:bg-gray-600 rounded w-4/5" />
    </div>
  );
}

export default function SearchResultsPage({ params }: { params: Promise<{ searchId: string }> }) {
  const { searchId } = use(params);
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState<SearchMeta | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchJobs = useCallback(async (p: number) => {
    if (p === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await fetch(`/api/saved-searches/${searchId}/jobs?page=${p}`)
      if (!res.ok) { router.replace("/dashboard"); return; }
      const data = await res.json();
      if (p === 1) {
        setJobs(data.jobs ?? []);
      } else {
        setJobs((prev) => [...prev, ...(data.jobs ?? [])]);
      }
      setTotal(data.total ?? 0);
      setHasMore(data.hasMore ?? false);
      setSearch(data.search ?? null);
      setPage(p);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [searchId, router]);

  useEffect(() => { fetchJobs(1); }, [fetchJobs]);

  function getLocationLabels(values: string[]) {
    return values.map((v) => LOCATIONS.find((l) => l.value === v)?.label ?? v).join(", ");
  }
  function getSeniorityLabels(values: string[]) {
    return values.map((v) => SENIORITY_LEVELS.find((s) => s.value === v)?.label ?? v).join(", ");
  }

  return (
    <div className="max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="mb-5">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1 mb-3"
        >
          ← Back
        </button>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          {search ? `${search.category} Jobs` : "Search Results"}
        </h1>
      </div>

      {/* Search metadata */}
      {search && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 mb-4 space-y-1.5">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span>
              <span className="font-medium text-gray-700 dark:text-gray-300">Keywords: </span>
              {search.keywords.slice(0, 6).join(", ")}
              {search.keywords.length > 6 && ` +${search.keywords.length - 6} more`}
            </span>
            {search.locations.length > 0 && (
              <span>
                <span className="font-medium text-gray-700 dark:text-gray-300">Locations: </span>
                {getLocationLabels(search.locations)}
              </span>
            )}
            {search.seniorities.length > 0 && (
              <span>
                <span className="font-medium text-gray-700 dark:text-gray-300">Seniority: </span>
                {getSeniorityLabels(search.seniorities)}
              </span>
            )}
          </div>
          {!loading && (
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {total.toLocaleString()} {total === 1 ? "job" : "jobs"} found
            </p>
          )}
        </div>
      )}

      {/* Job list */}
      {loading ? (
        <div className="space-y-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-10 text-center">
          <p className="text-gray-700 dark:text-gray-300 font-medium">No jobs found for this search.</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            New jobs are scraped daily — check back soon.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                showScore={false}
                showSource={true}
                onDismiss={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))}
              />
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => fetchJobs(page + 1)}
                disabled={loadingMore}
                className="px-6 py-2 border dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? "Loading…" : "Load More"}
              </button>
            </div>
          )}

          {!hasMore && jobs.length > 0 && (
            <p className="text-center py-4 text-sm text-gray-400 dark:text-gray-500">
              All {total.toLocaleString()} jobs loaded
            </p>
          )}
        </>
      )}
    </div>
  );
}
