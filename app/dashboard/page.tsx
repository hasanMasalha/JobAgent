"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  return (job.claude_score ?? 0) > 0 ? job.claude_score! : Math.round((job.similarity ?? 0) * 100);
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

interface BrowseJob {
  id: string;
  title: string;
  company: string;
  description: string;
  location: string | null;
  url: string;
  source: string;
  salary_min: number | null;
  salary_max: number | null;
  scraped_at: string;
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

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<"matches" | "browse">("matches");

  // --- My Matches state ---
  const [jobs, setJobs] = useState<Job[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const router = useRouter();

  // --- Browse state ---
  const [browseSearch, setBrowseSearch] = useState("");
  const [browseLocation, setBrowseLocation] = useState("");
  const [browseCompany, setBrowseCompany] = useState("");
  const [browseSource, setBrowseSource] = useState("");
  const [browsePage, setBrowsePage] = useState(1);
  const [browseJobs, setBrowseJobs] = useState<BrowseJob[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseTotalPages, setBrowseTotalPages] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseGoTo, setBrowseGoTo] = useState("");
  const browseListRef = useRef<HTMLDivElement>(null);
  const browseDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Always-fresh filter values — avoids stale closures inside debounce timers
  const browseFiltersRef = useRef({ search: "", location: "", company: "", source: "" });
  browseFiltersRef.current = { search: browseSearch, location: browseLocation, company: browseCompany, source: browseSource };

  const fetchBrowse = useCallback(async (page: number) => {
    setBrowseLoading(true);
    try {
      const { search, location, company, source } = browseFiltersRef.current;
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      if (location) params.set("location", location);
      if (company) params.set("company", company);
      if (source) params.set("source", source);
      const res = await fetch(`/api/jobs/browse?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setBrowseJobs(data.jobs);
      setBrowseTotal(data.total);
      setBrowseTotalPages(data.total_pages);
      setBrowsePage(data.page);
    } catch (err) {
      console.error("browse:", err);
    } finally {
      setBrowseLoading(false);
    }
  }, []); // stable — reads live values via ref

  function debounceBrowse(delay = 400) {
    clearTimeout(browseDebounceRef.current);
    browseDebounceRef.current = setTimeout(() => fetchBrowse(1), delay);
  }

  function clearBrowseFilters() {
    setBrowseSearch("");
    setBrowseLocation("");
    setBrowseCompany("");
    setBrowseSource("");
    // Fire after re-render so ref reflects cleared values
    setTimeout(() => fetchBrowse(1), 0);
  }

  function goToPage(p: number) {
    if (p < 1 || p > browseTotalPages) return;
    fetchBrowse(p);
    setTimeout(() => browseListRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  useEffect(() => {
    if (activeTab === "browse") fetchBrowse(1);
  }, [activeTab, fetchBrowse]);

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

  const hasBrowseFilter = browseSearch || browseLocation || browseCompany || browseSource;
  const browseFrom = browseTotal === 0 ? 0 : (browsePage - 1) * 20 + 1;
  const browseTo = browseFrom > 0 ? browseFrom + browseJobs.length - 1 : 0;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b dark:border-gray-700">
        {(["matches", "browse"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {tab === "matches" ? "My Matches" : "Browse All Jobs"}
          </button>
        ))}
      </div>

      {/* ── My Matches ── */}
      {activeTab === "matches" && (
        <>
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
        </>
      )}

      {/* ── Browse All Jobs ── */}
      {activeTab === "browse" && (
        <div>
          {/* Search bar */}
          <div className="relative mb-3">
            <input
              type="text"
              value={browseSearch}
              onChange={(e) => {
                setBrowseSearch(e.target.value);
                debounceBrowse(400);
              }}
              placeholder="Search by title, company, or keyword..."
              className="w-full px-4 py-2.5 pr-10 border rounded-xl text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {browseLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <svg className="animate-spin h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
            )}
          </div>

          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              type="text"
              value={browseLocation}
              onChange={(e) => {
                setBrowseLocation(e.target.value);
                debounceBrowse(400);
              }}
              placeholder="Location"
              className="w-36 px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={browseCompany}
              onChange={(e) => {
                setBrowseCompany(e.target.value);
                debounceBrowse(400);
              }}
              placeholder="Company"
              className="w-36 px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={browseSource}
              onChange={(e) => {
                setBrowseSource(e.target.value);
                setTimeout(() => fetchBrowse(1), 0);
              }}
              className="px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All sources</option>
              <option value="Indeed">Indeed</option>
              <option value="LinkedIn">LinkedIn</option>
              <option value="company_careers">Company Careers</option>
            </select>
            {hasBrowseFilter && (
              <button
                onClick={clearBrowseFilters}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Results count */}
          {!browseLoading && browseTotal > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Showing {browseFrom}–{browseTo} of {browseTotal.toLocaleString()} jobs
            </p>
          )}

          {/* Job list */}
          <div ref={browseListRef}>
            {browseLoading ? (
              <div className="space-y-4">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : browseJobs.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-10 text-center">
                <p className="text-gray-700 dark:text-gray-300 font-medium">
                  No jobs found matching your filters.
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Try different keywords
                  {hasBrowseFilter && (
                    <>
                      {" or "}
                      <button
                        onClick={clearBrowseFilters}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        clear the filters
                      </button>
                    </>
                  )}
                  .
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {browseJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    showScore={false}
                    showSource={true}
                    onDismiss={(id) => setBrowseJobs((prev) => prev.filter((j) => j.id !== id))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {!browseLoading && browseTotalPages > 1 && (
            <div className="mt-6 flex flex-col items-center gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => goToPage(browsePage - 1)}
                  disabled={browsePage <= 1}
                  className="text-sm px-3 py-1.5 border rounded-lg hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  ← Previous
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Page {browsePage} of {browseTotalPages}
                </span>
                <button
                  onClick={() => goToPage(browsePage + 1)}
                  disabled={browsePage >= browseTotalPages}
                  className="text-sm px-3 py-1.5 border rounded-lg hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  Next →
                </button>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <span>Go to page</span>
                <input
                  type="number"
                  min={1}
                  max={browseTotalPages}
                  value={browseGoTo}
                  onChange={(e) => setBrowseGoTo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const p = parseInt(browseGoTo, 10);
                      if (!isNaN(p)) {
                        goToPage(p);
                        setBrowseGoTo("");
                      }
                    }
                  }}
                  placeholder={String(browsePage)}
                  className="w-16 px-2 py-1 border rounded-lg text-center text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span>of {browseTotalPages}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
