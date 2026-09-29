"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import JobCard, { Job } from "@/app/dashboard/JobCard";
import { Button, PageHero, RemovableTag, SkeletonCard, StatePanel } from "@/app/components/ui";
import { LOCATIONS, SENIORITY_LEVELS } from "@/lib/job-categories";

interface SearchMeta {
  id: string;
  category: string;
  keywords: string[];
  locations: string[];
  seniorities: string[];
}

const cardCls = "rounded-[1.375rem] bg-surface-raised p-5 shadow-dossier ring-1 ring-line/60 sm:p-6";
const groupLabel = "text-caption font-semibold uppercase tracking-wide text-ink-subtle";

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

  const hasFilters = activeKeywords.length + activeLocations.length + activeSeniorities.length > 0;

  return (
    <div className="w-full">
      <PageHero
        tabs={
          <Link href="/dashboard" className="inline-flex items-center gap-1 rounded-sm text-body-sm text-on-hero-muted hover:text-on-hero focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
            <span aria-hidden="true">←</span> Saved searches
          </Link>
        }
        title={search ? `${search.category} jobs` : "Search results"}
        meta={!loading && search && (
          <span className="text-body-sm text-on-hero-muted tabular-nums">
            {total.toLocaleString()} {total === 1 ? "job" : "jobs"} found
          </span>
        )}
      />

      <div className="relative mx-auto -mt-14 max-w-3xl space-y-4 pb-24 sm:-mt-16 sm:pb-10">
        {search && hasFilters && (
          <section aria-label="Filters for this search" className={cardCls}>
            <div className="space-y-4">
              {activeKeywords.length > 0 && (
                <div>
                  <h2 className={groupLabel}>Keywords</h2>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeKeywords.map((keyword) => (
                      <RemovableTag key={keyword} label={keyword} onRemove={() => removeKeyword(keyword)} />
                    ))}
                  </div>
                </div>
              )}
              {activeLocations.length > 0 && (
                <div>
                  <h2 className={groupLabel}>Locations</h2>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeLocations.map((locValue) => (
                      <RemovableTag
                        key={locValue}
                        label={LOCATIONS.find((l) => l.value === locValue)?.label ?? locValue}
                        onRemove={() => removeLocation(locValue)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {activeSeniorities.length > 0 && (
                <div>
                  <h2 className={groupLabel}>Seniority</h2>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeSeniorities.map((senValue) => (
                      <RemovableTag
                        key={senValue}
                        label={SENIORITY_LEVELS.find((s) => s.value === senValue)?.label ?? senValue}
                        onRemove={() => removeSeniority(senValue)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <p className="mt-4 border-t border-line pt-3 text-caption text-ink-subtle">
              Removing a filter here only changes this view. Edit the search on the dashboard to keep it.
            </p>
          </section>
        )}

        {loading ? (
          <div className="space-y-4" aria-busy="true">
            <SkeletonCard lines={2} /><SkeletonCard lines={2} /><SkeletonCard lines={2} />
            <span className="sr-only" role="status">Loading jobs</span>
          </div>
        ) : jobs.length === 0 ? (
          <StatePanel title="No jobs match this search yet">
            Try removing a filter, or check back after the next daily scrape.
          </StatePanel>
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

            {hasMore ? (
              <div className="flex justify-center pt-2">
                <Button variant="secondary" size="lg" onClick={loadMoreJobs} disabled={loadingMore} loading={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : (
              <p className="py-2 text-center text-body-sm text-ink-subtle">
                That&apos;s all {total.toLocaleString()} {total === 1 ? "job" : "jobs"}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
