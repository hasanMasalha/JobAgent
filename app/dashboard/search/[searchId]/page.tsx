"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
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

export default function SearchResultsPage() {
  const routeParams = useParams();
  const searchId = routeParams?.searchId as string;
  const router = useRouter();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState<SearchMeta | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Editable filter state — initialised from saved search on first load
  const [activeKeywords, setActiveKeywords] = useState<string[]>([]);
  const [activeLocations, setActiveLocations] = useState<string[]>([]);
  const [activeSeniorities, setActiveSeniorities] = useState<string[]>([]);
  const filtersInitialized = useRef(false);

  // Initial load via GET — also returns search metadata
  const fetchJobs = useCallback(async (p: number) => {
    if (p === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await fetch(`/api/saved-searches/${searchId}/jobs?page=${p}`);
      if (!res.ok) { router.replace("/dashboard"); return; }
      const data = await res.json();
      const s: SearchMeta | null = data.search ?? null;
      if (p === 1) {
        setJobs(data.jobs ?? []);
        setSearch(s);
        if (s && !filtersInitialized.current) {
          filtersInitialized.current = true;
          setActiveKeywords(s.keywords);
          setActiveLocations(s.locations);
          setActiveSeniorities(s.seniorities);
        }
      } else {
        setJobs((prev) => [...prev, ...(data.jobs ?? [])]);
      }
      setTotal(data.total ?? 0);
      setHasMore(data.hasMore ?? false);
      setPage(p);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [searchId, router]);

  useEffect(() => { fetchJobs(1); }, [fetchJobs]);

  // POST-based fetch used after any filter change
  async function fetchJobsWithFilters(
    keywords: string[],
    locations: string[],
    seniorities: string[]
  ) {
    setLoading(true);
    setPage(1);
    try {
      const res = await fetch(`/api/saved-searches/${searchId}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, locations, seniorities, page: 1 }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setTotal(data.total ?? 0);
      setHasMore(data.hasMore ?? false);
    } finally {
      setLoading(false);
    }
  }

  // Load more using POST with the current active filters
  async function loadMoreJobs() {
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/saved-searches/${searchId}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: activeKeywords,
          locations: activeLocations,
          seniorities: activeSeniorities,
          page: nextPage,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setJobs((prev) => [...prev, ...(data.jobs ?? [])]);
      setHasMore(data.hasMore ?? false);
      setPage(nextPage);
    } finally {
      setLoadingMore(false);
    }
  }

  function removeKeyword(keyword: string) {
    const updated = activeKeywords.filter((k) => k !== keyword);
    setActiveKeywords(updated);
    fetchJobsWithFilters(updated, activeLocations, activeSeniorities);
  }

  function removeLocation(locValue: string) {
    const updated = activeLocations.filter((l) => l !== locValue);
    setActiveLocations(updated);
    fetchJobsWithFilters(activeKeywords, updated, activeSeniorities);
  }

  function removeSeniority(senValue: string) {
    const updated = activeSeniorities.filter((s) => s !== senValue);
    setActiveSeniorities(updated);
    fetchJobsWithFilters(activeKeywords, activeLocations, updated);
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

      {/* Editable filter pills */}
      {search && (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 mb-4 space-y-3">
          {/* Keywords */}
          {activeKeywords.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Keywords
              </p>
              <div className="flex flex-wrap gap-1.5">
                {activeKeywords.map((keyword) => (
                  <button
                    key={keyword}
                    onClick={() => removeKeyword(keyword)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full text-xs hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  >
                    {keyword}
                    <span className="opacity-70">×</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Locations */}
          {activeLocations.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Locations
              </p>
              <div className="flex flex-wrap gap-1.5">
                {activeLocations.map((locValue) => {
                  const label = LOCATIONS.find((l) => l.value === locValue)?.label ?? locValue;
                  return (
                    <button
                      key={locValue}
                      onClick={() => removeLocation(locValue)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    >
                      {label}
                      <span className="opacity-70">×</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Seniority */}
          {activeSeniorities.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Seniority
              </p>
              <div className="flex flex-wrap gap-1.5">
                {activeSeniorities.map((senValue) => {
                  const label = SENIORITY_LEVELS.find((s) => s.value === senValue)?.label ?? senValue;
                  return (
                    <button
                      key={senValue}
                      onClick={() => removeSeniority(senValue)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    >
                      {label}
                      <span className="opacity-70">×</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!loading && (
            <p className="text-sm font-medium text-gray-900 dark:text-white pt-1 border-t dark:border-gray-700">
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
            Try removing some filters or check back when new jobs are scraped.
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
                onClick={loadMoreJobs}
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
