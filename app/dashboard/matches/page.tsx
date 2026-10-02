"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import JobCard, { Job } from "@/app/dashboard/JobCard";
import JobFilters, { DEFAULT_FILTERS, Filters } from "@/app/components/JobFilters";
import { showToast } from "@/app/components/Toast";
import { cn } from "@/lib/cn";
import { displayApplyType } from "@/lib/detect-apply-type";
import {
  Button,
  buttonStyles,
  inputStyles,
  Spinner,
  PageHero,
  HeroTabs,
  heroControlStyles,
  StatePanel,
  RefreshIcon,
  SearchIcon,
  ChevronDownIcon,
  ExtensionIcon,
  AutoIcon,
  ExternalIcon,
  BrokenRouteIllustration,
  HorizonIllustration,
  FunnelIllustration,
  LockedStackIllustration,
  EmptySearchIllustration,
} from "@/app/components/ui";

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
  if (sortBy === "score") arr.sort((a, b) => jobScore(b) - jobScore(a));
  else if (sortBy === "newest") arr.sort((a, b) => new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime());
  else if (sortBy === "salary") {
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

const FEATURED_LABEL: Record<Filters["sortBy"], string> = {
  score: "Top match",
  newest: "Newest",
  salary: "Highest salary",
};

const APPLY_TYPE_TABS = [
  { id: "all", label: "All", Icon: null },
  { id: "extension", label: "Extension", Icon: ExtensionIcon },
  { id: "auto", label: "Auto", Icon: AutoIcon },
  { id: "external", label: "External", Icon: ExternalIcon },
] as const;

/** Loading shape of an ordinary job card. */
function CardSkeleton() {
  return (
    <div aria-hidden="true" className="flex gap-4 rounded-[1.125rem] border border-line bg-surface p-5 sm:p-6">
      <div className="flex-1 space-y-2.5">
        <Shimmer className="h-5 w-3/5" />
        <Shimmer className="h-3.5 w-2/5" />
        <Shimmer className="!mt-6 h-1.5 w-full rounded-full" />
        <Shimmer className="h-3 w-4/5" />
      </div>
    </div>
  );
}

/** A slow shimmer rather than a blink — calmer for a screen people wait on. */
function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-control bg-surface-sunken",
        "motion-safe:animate-shimmer motion-safe:bg-[linear-gradient(90deg,rgb(var(--c-surface-sunken))_0%,rgb(var(--c-surface))_45%,rgb(var(--c-surface-sunken))_90%)] motion-safe:bg-[length:220%_100%]",
        className,
      )}
    />
  );
}

/** Loading shape of the featured card + two ordinary cards. */
function MatchesSkeleton({ featured = true }: { featured?: boolean }) {
  return (
    <div role="status">
      <span className="sr-only">Loading jobs</span>
      {featured && (
        <div aria-hidden="true" className="grid gap-8 rounded-[1.375rem] bg-surface-raised p-5 shadow-dossier ring-1 ring-line/60 sm:p-8 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-12 lg:p-10">
          <div className="space-y-3">
            <Shimmer className="h-6 w-36 rounded-full" />
            <Shimmer className="!mt-6 h-10 w-3/4 sm:w-3/5" />
            <Shimmer className="h-4 w-2/5" />
            <Shimmer className="!mt-7 h-3.5 w-full" />
            <Shimmer className="h-3.5 w-11/12" />
            <Shimmer className="h-3.5 w-2/3" />
          </div>
          <div className="flex flex-col items-center gap-3">
            <div className="hidden h-36 w-36 rounded-full border-8 border-surface-sunken lg:block" />
            <Shimmer className="h-11 w-full lg:mt-3" />
            <Shimmer className="h-11 w-full" />
          </div>
        </div>
      )}
      <div className={cn("grid gap-4 lg:grid-cols-2", featured && "mt-8")}>
        <CardSkeleton />
        <CardSkeleton />
        {!featured && <><CardSkeleton /><CardSkeleton /></>}
      </div>
    </div>
  );
}

function BrowseLockedState() {
  return (
    <div className="relative">
      <div className="pointer-events-none select-none space-y-4 opacity-70 blur-[3px]" aria-hidden="true">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <div className="absolute inset-0 flex items-start justify-center pt-6 sm:pt-10">
        <div className="w-full max-w-md rounded-[1.375rem] bg-surface-raised px-6 pb-8 pt-9 text-center shadow-dossier ring-1 ring-line/60 motion-safe:animate-lift-in sm:px-10">
          <div className="flex justify-center"><LockedStackIllustration /></div>
          <h2 className="mt-6 text-balance font-serif text-[1.625rem] font-medium leading-tight text-ink sm:text-[1.75rem]">
            Upgrade to unlock Browse All Jobs
          </h2>
          <p className="mt-3 text-body text-ink-muted">
            Browse All Jobs is available on Pro and Unlimited plans.
          </p>
          <a
            href="/pricing"
            className={cn(buttonStyles({ variant: "accent", size: "lg", block: true }), "mt-7")}
          >
            Upgrade to Pro - $24/month
          </a>
        </div>
      </div>
    </div>
  );
}

const linkStyles = "font-semibold text-brand-text underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

export default function MatchesPage() {
  const [activeTab, setActiveTab] = useState<"matches" | "browse">("matches");
  const [plan, setPlan] = useState<"free" | "pro" | "unlimited" | null>(null);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [appliedJobIds, setAppliedJobIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [matchPage, setMatchPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [applyTypeFilter, setApplyTypeFilter] = useState<"all" | "extension" | "auto" | "external">("all");
  const [batchApplying, setBatchApplying] = useState(false);

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
  const [browseError, setBrowseError] = useState<{ code: string; message: string } | null>(null);
  const browseListRef = useRef<HTMLDivElement>(null);
  const browseDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const browseFiltersRef = useRef({ search: "", location: "", company: "", source: "" });
  browseFiltersRef.current = { search: browseSearch, location: browseLocation, company: browseCompany, source: browseSource };

  const fetchBrowse = useCallback(async (page: number) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const { search, location, company, source } = browseFiltersRef.current;
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      if (location) params.set("location", location);
      if (company) params.set("company", company);
      if (source) params.set("source", source);
      const res = await fetch(`/api/jobs/browse?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setBrowseError({ code: data.error ?? "generic", message: data.message ?? "Failed to load jobs." });
        setBrowseJobs([]);
        return;
      }
      setBrowseJobs(data.jobs);
      setBrowseTotal(data.total);
      setBrowseTotalPages(data.total_pages);
      setBrowsePage(data.page);
    } catch (err) {
      console.error("browse:", err);
      setBrowseError({ code: "generic", message: "Failed to load jobs." });
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  function debounceBrowse(delay = 400) {
    clearTimeout(browseDebounceRef.current);
    browseDebounceRef.current = setTimeout(() => fetchBrowse(1), delay);
  }

  function clearBrowseFilters() {
    setBrowseSearch(""); setBrowseLocation(""); setBrowseCompany(""); setBrowseSource("");
    setTimeout(() => fetchBrowse(1), 0);
  }

  function goToPage(p: number) {
    if (p < 1 || p > browseTotalPages) return;
    fetchBrowse(p);
    setTimeout(() => browseListRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  useEffect(() => {
    if (activeTab === "browse" && plan && plan !== "free") fetchBrowse(1);
  }, [activeTab, plan, fetchBrowse]);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => { if (d.plan) setPlan(d.plan); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--chat-fab-bottom",
      // Clear the batch-apply dock, which stacks to two rows below 640px.
      selectedJobs.length > 0 ? (window.innerWidth < 640 ? "136px" : "96px") : "24px"
    );
  }, [selectedJobs.length]);

  const toggleJobSelection = (jobId: string) =>
    setSelectedJobs((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]
    );

  const getSelectedCounts = () => {
    const sel = jobs.filter((j) => selectedJobs.includes(j.id));
    return {
      extension: sel.filter((j) => j.apply_type === "extension").length,
      auto: sel.filter((j) => j.apply_type === "auto").length,
    };
  };

  const handleBatchApply = async () => {
    if (batchApplying) return;
    const sel = jobs.filter((j) => selectedJobs.includes(j.id));
    const extensionJobs = sel.filter((j) => j.apply_type === "extension");
    const autoJobs = sel.filter((j) => j.apply_type === "auto");
    setBatchApplying(true);
    try {
      if (autoJobs.length > 0) {
        const res = await fetch("/api/apply/batch-auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobIds: autoJobs.map((j) => j.id) }),
        });
        const data = await res.json();
        if (res.ok) showToast(`Sent ${data.count} auto application${data.count !== 1 ? "s" : ""}!`, "success");
        else if (data.error === "limit_reached") showToast("You've reached your monthly auto-apply limit. Upgrade on the Pricing page for more.", "error");
      }
      if (extensionJobs.length > 0) {
        const res = await fetch("/api/apply/batch-mark-pending", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobIds: extensionJobs.map((j) => j.id) }),
        });
        const data = await res.json();
        if (res.status === 403 && data.error === "limit_reached") {
          showToast("You've reached your monthly auto-apply limit. Upgrade on the Pricing page for more.", "error");
          return;
        }
        if (!res.ok || !data.results?.length) {
          showToast("Failed to prepare applications. Please try again.", "error");
          return;
        }
        // Some jobs weren't queued because the monthly limit ran out mid-batch.
        const skipped: number = data.limitReached?.length ?? 0;
        const skippedNote = skipped > 0 ? ` ${skipped} not queued — monthly auto-apply limit reached.` : "";
        const queueJobs = data.results.map((r: { jobId: string; applicationId: string; jobUrl: string }) => ({
          id: r.applicationId,
          url: r.jobUrl,
        }));
        const extensionId = process.env.NEXT_PUBLIC_EXTENSION_ID ?? "";
        if (!extensionId) { showToast("Extension ID not configured", "error"); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chromeRuntime = (window as any).chrome?.runtime;
        if (!chromeRuntime?.sendMessage) { showToast("Extension not detected.", "error"); return; }
        chromeRuntime.sendMessage(
          extensionId,
          { type: "START_APPLY_QUEUE", jobs: queueJobs },
          (response: unknown) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const err = (window as any).chrome?.runtime?.lastError;
            if (err) {
              if (err.message.includes("port closed") || err.message.includes("message port closed")) {
                showToast(`Starting extension apply for ${queueJobs.length} job${queueJobs.length !== 1 ? "s" : ""}…${skippedNote}`, "success");
                return;
              }
              showToast(`Extension error: ${err.message}`, "error");
            } else {
              console.log("batch response:", response);
              showToast(`Starting extension apply for ${queueJobs.length} job${queueJobs.length !== 1 ? "s" : ""}…${skippedNote}`, "success");
            }
          }
        );
      }
    } catch (e) {
      console.error("batch apply error:", e);
      showToast("Batch apply failed", "error");
    } finally {
      setBatchApplying(false);
      setSelectedJobs([]);
    }
  };

  const fetchJobs = useCallback(async (isRefresh = false) => {
    setLoading(true);
    setError(null);
    setMatchPage(1);
    setHasMore(true);
    try {
      const params = new URLSearchParams({ page: "1", limit: "20" });
      if (isRefresh) params.set("refresh", "true");
      const [matchRes, savedRes, appliedRes] = await Promise.all([
        fetch(`/api/match?${params}`),
        fetch("/api/jobs/saved"),
        fetch("/api/applications?ids_only=true"),
      ]);
      const matchText = await matchRes.text();
      let matchData: { jobs: Job[]; hasMore: boolean; total: number; error?: string };
      try {
        matchData = JSON.parse(matchText);
      } catch {
        throw new Error("Unable to load matches. Please refresh in a moment.");
      }
      if (!matchRes.ok || matchData.error) throw new Error(matchData.error ?? "Failed to load jobs");
      setJobs(matchData.jobs);
      setHasMore(matchData.hasMore);
      setLastFetched(new Date());
      if (savedRes.ok) {
        const savedData = await savedRes.json();
        setSavedIds(new Set((savedData.jobs ?? []).map((j: { id: string }) => j.id)));
      }
      if (appliedRes.ok) {
        const appliedData = await appliedRes.json();
        setAppliedJobIds(new Set(appliedData.appliedJobIds ?? []));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMoreJobs = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    const nextPage = matchPage + 1;
    const savedScrollY = window.scrollY;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/match?page=${nextPage}&limit=20`);
      if (!res.ok) return;
      const text = await res.text();
      let data: { jobs: Job[]; hasMore: boolean; error?: string };
      try { data = JSON.parse(text); } catch { return; }
      if (data.error || !Array.isArray(data.jobs)) return;
      setJobs((prev) => [...prev, ...data.jobs]);
      setMatchPage(nextPage);
      setHasMore(data.hasMore);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo({ top: savedScrollY, behavior: "instant" });
        });
      });
    } catch (err) {
      console.error("[loadMore]", err);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, matchPage]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && hasMore && !loadingMore) loadMoreJobs(); },
      { threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadMoreJobs, loading]);

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
      .filter((job) => !appliedJobIds.has(job.id))
      .filter((job) => applyTypeFilter === "all" || displayApplyType(job) === applyTypeFilter)
      .filter((job) => workTypeMatch(job, filters.workTypes))
      .filter((job) => jobTypeMatch(job, filters.jobTypes))
      .filter((job) => dateMatch(job, filters.daysPosted))
      .filter((job) => salaryMatch(job, filters.minSalary));
    return applySort(filtered, filters.sortBy);
  }, [jobs, appliedJobIds, filters, applyTypeFilter]);

  const selectAllVisible = () =>
    setSelectedJobs(filteredJobs.filter((j) => j.apply_type && j.apply_type !== "external").map((j) => j.id));

  const hasBrowseFilter = browseSearch || browseLocation || browseCompany || browseSource;
  const browseFrom = browseTotal === 0 ? 0 : (browsePage - 1) * 20 + 1;
  const browseTo = browseFrom > 0 ? browseFrom + browseJobs.length - 1 : 0;
  const counts = getSelectedCounts();

  const showBrowse = activeTab === "browse" && (plan === "pro" || plan === "unlimited") && browseError?.code !== "plan_restricted";
  const matchesReady = !loading && !error && jobs.length > 0;
  const [featuredJob, ...otherJobs] = filteredJobs;

  return (
    <div className="w-full">
      <PageHero
        tabs={
          <HeroTabs
            label="Job lists"
            active={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: "matches", label: "My Matches" },
              { id: "browse", label: "Browse All Jobs" },
            ]}
          />
        }
        title={activeTab === "matches" ? "Matched Jobs" : "Browse All Jobs"}
        subtitle={activeTab === "matches" ? "Top matches based on your CV" : undefined}
        meta={
          activeTab === "matches" && (
            <>
              {lastFetched && !loading && (
                <span className="hidden text-body-sm text-on-hero-muted sm:inline">
                  Last updated: {timeAgo(lastFetched)}
                </span>
              )}
              <button
                onClick={() => fetchJobs(true)}
                disabled={loading}
                className={cn(heroControlStyles({ size: "custom" }), "inline-flex h-10 items-center gap-2 px-4 text-sm font-semibold")}
              >
                {loading ? <Spinner size="sm" decorative /> : <RefreshIcon className="h-3.5 w-3.5" />}
                {loading ? "Loading…" : "Refresh"}
              </button>
            </>
          )
        }
      >
        {activeTab === "matches" && (
          <>
            <JobFilters
              filters={filters}
              onChange={setFilters}
              matchCount={matchesReady ? filteredJobs.length : undefined}
              totalCount={matchesReady ? jobs.length : undefined}
            />
            {matchesReady && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <div role="group" aria-label="Apply route" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 py-1 sm:mx-0 sm:rounded-full sm:border sm:border-white/10 sm:bg-white/[0.05] sm:p-1">
                  {APPLY_TYPE_TABS.map(({ id, label, Icon }) => {
                    const on = applyTypeFilter === id;
                    return (
                      <button
                        key={id}
                        aria-pressed={on}
                        onClick={() => { setApplyTypeFilter(id); setSelectedJobs([]); }}
                        className={cn(
                          "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-body-sm font-semibold transition-colors duration-200",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
                          on ? "bg-on-hero text-hero-from" : "border border-white/10 text-on-hero-muted hover:text-on-hero sm:border-0",
                        )}
                      >
                        {Icon && <Icon className="h-3.5 w-3.5" />}
                        {label}
                      </button>
                    );
                  })}
                </div>
                {applyTypeFilter !== "external" && applyTypeFilter !== "all" && filteredJobs.length > 0 && (
                  <button
                    onClick={selectAllVisible}
                    className="inline-flex h-9 items-center rounded-full border border-dashed border-white/30 px-3.5 text-body-sm font-semibold text-on-hero transition-colors hover:border-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  >
                    Select all {filteredJobs.length}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {showBrowse && (
          <div>
            <div className="relative">
              <label htmlFor="browse-search" className="sr-only">Search jobs</label>
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-on-hero-muted" />
              <input
                id="browse-search"
                type="text"
                value={browseSearch}
                onChange={(e) => { setBrowseSearch(e.target.value); debounceBrowse(400); }}
                placeholder="Search by title, company, or keyword..."
                className={cn(heroControlStyles({ size: "custom" }), "h-12 w-full pl-11 pr-11 text-body")}
              />
              {browseLoading && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-on-hero-muted">
                  <Spinner size="sm" label="Searching" />
                </span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
              <label htmlFor="browse-location" className="sr-only">Location</label>
              <input id="browse-location" type="text" value={browseLocation} onChange={(e) => { setBrowseLocation(e.target.value); debounceBrowse(400); }} placeholder="Location" className={cn(heroControlStyles(), "w-full sm:w-44")} />
              <label htmlFor="browse-company" className="sr-only">Company</label>
              <input id="browse-company" type="text" value={browseCompany} onChange={(e) => { setBrowseCompany(e.target.value); debounceBrowse(400); }} placeholder="Company" className={cn(heroControlStyles(), "w-full sm:w-44")} />
              <label htmlFor="browse-source" className="sr-only">Source</label>
              <div className="relative col-span-2 sm:col-span-1">
                <select id="browse-source" value={browseSource} onChange={(e) => { setBrowseSource(e.target.value); setTimeout(() => fetchBrowse(1), 0); }} className={cn(heroControlStyles({ size: "custom" }), "h-10 w-full cursor-pointer appearance-none pl-3.5 pr-9 text-sm font-medium sm:w-44")}>
                  <option value="">All sources</option>
                  <option value="indeed">Indeed</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="company_careers">Company Careers</option>
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-on-hero-muted" />
              </div>
              {hasBrowseFilter && (
                <button onClick={clearBrowseFilters} className="h-10 rounded-control px-2 text-body-sm font-semibold text-on-hero underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">Clear filters</button>
              )}
            </div>
            {!browseLoading && browseTotal > 0 && (
              <p className="mt-3 text-right text-body-sm text-on-hero-muted">
                Showing {browseFrom}–{browseTo} of {browseTotal.toLocaleString()} jobs
              </p>
            )}
          </div>
        )}
      </PageHero>

      <div className="relative mx-auto -mt-14 max-w-6xl sm:-mt-16">
        {activeTab === "matches" && (
          <>
            {loading && <MatchesSkeleton />}

            {error && (
              <StatePanel
                role="alert"
                illustration={<BrokenRouteIllustration />}
                title="Matches are loading…"
                action={
                  <Button size="lg" onClick={() => fetchJobs()}>
                    <RefreshIcon />
                    Try again
                  </Button>
                }
              >
                {error}
              </StatePanel>
            )}

            {!loading && !error && jobs.length === 0 && (
              <StatePanel illustration={<HorizonIllustration />} title="No new matches today.">
                Check back tomorrow or{" "}
                <a href="/dashboard/onboarding" className={linkStyles}>update your preferences</a>.
              </StatePanel>
            )}

            {matchesReady && filteredJobs.length === 0 && (
              <StatePanel illustration={<FunnelIllustration />} title="No jobs match your filters.">
                Try adjusting the filters above.
              </StatePanel>
            )}

            {!loading && !error && featuredJob && (
              <>
                <JobCard
                  key={featuredJob.id}
                  variant="featured"
                  featuredLabel={FEATURED_LABEL[filters.sortBy]}
                  job={featuredJob}
                  initialSaved={savedIds.has(featuredJob.id)}
                  selected={selectedJobs.includes(featuredJob.id)}
                  onSelect={toggleJobSelection}
                  onDismiss={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))}
                  onApply={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))}
                />
                {otherJobs.length > 0 && (
                  <section aria-labelledby="more-matches" className="mt-10 sm:mt-12">
                    <h2 id="more-matches" className="mb-4 font-serif text-title-serif text-ink">More matches</h2>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {otherJobs.map((job) => (
                        <JobCard
                          key={job.id}
                          job={job}
                          initialSaved={savedIds.has(job.id)}
                          selected={selectedJobs.includes(job.id)}
                          onSelect={toggleJobSelection}
                          onDismiss={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))}
                          onApply={(id) => setJobs((prev) => prev.filter((j) => j.id !== id))}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {matchesReady && (
              <>
                <div ref={sentinelRef} style={{ height: "1px" }} />
                {loadingMore && (
                  <div className="flex justify-center py-6 text-ink-subtle">
                    <Spinner label="Loading more matches" />
                  </div>
                )}
                {!hasMore && (
                  <p className="py-8 text-center text-body-sm text-ink-subtle">All matches loaded</p>
                )}
              </>
            )}
          </>
        )}

        {activeTab === "browse" && plan === null && <MatchesSkeleton featured={false} />}

        {activeTab === "browse" && (plan === "free" || browseError?.code === "plan_restricted") && (
          <BrowseLockedState />
        )}

        {showBrowse && (
          <div ref={browseListRef} className="scroll-mt-24">
            {browseLoading ? (
              <MatchesSkeleton featured={false} />
            ) : browseError?.code === "limit_reached" ? (
              <StatePanel illustration={<HorizonIllustration />} title="You've reached your daily Browse All Jobs limit.">
                <a href="/pricing" className={linkStyles}>Upgrade for more</a>.
              </StatePanel>
            ) : browseJobs.length === 0 ? (
              <StatePanel illustration={<EmptySearchIllustration />} title="No jobs found matching your filters.">
                Try different keywords{hasBrowseFilter && <>{" or "}<button onClick={clearBrowseFilters} className={linkStyles}>clear the filters</button></>}.
              </StatePanel>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {browseJobs.map((job) => (
                  <JobCard key={job.id} job={job} showScore={false} showSource={true} onDismiss={(id) => setBrowseJobs((prev) => prev.filter((j) => j.id !== id))} />
                ))}
              </div>
            )}

            {!browseLoading && browseTotalPages > 1 && (
              <nav aria-label="Pagination" className="mt-10 flex flex-col items-center gap-4">
                <div className="flex items-center gap-3">
                  <Button variant="secondary" onClick={() => goToPage(browsePage - 1)} disabled={browsePage <= 1}>← Previous</Button>
                  <span className="text-body-sm text-ink-muted">Page {browsePage} of {browseTotalPages}</span>
                  <Button variant="secondary" onClick={() => goToPage(browsePage + 1)} disabled={browsePage >= browseTotalPages}>Next →</Button>
                </div>
                <div className="flex items-center gap-2 text-body-sm text-ink-muted">
                  <label htmlFor="browse-goto">Go to page</label>
                  <input
                    id="browse-goto"
                    type="number" min={1} max={browseTotalPages} value={browseGoTo}
                    onChange={(e) => setBrowseGoTo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { const p = parseInt(browseGoTo, 10); if (!isNaN(p)) { goToPage(p); setBrowseGoTo(""); } } }}
                    placeholder={String(browsePage)}
                    className={cn(inputStyles(), "h-9 w-16 text-center")}
                  />
                  <span>of {browseTotalPages}</span>
                </div>
              </nav>
            )}
          </div>
        )}
      </div>

      {selectedJobs.length > 0 && (
        <div
          role="region"
          aria-label="Batch apply"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-overlay border border-white/10 bg-hero-via p-3 text-on-hero shadow-overlay motion-safe:animate-lift-in sm:bottom-6 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:rounded-full sm:py-2 sm:pl-7 sm:pr-2"
        >
          <div className="flex min-w-0 items-baseline gap-3 px-1 sm:px-0">
            <span className="whitespace-nowrap font-serif text-lg font-medium sm:text-xl">{selectedJobs.length} selected</span>
            <span className="flex items-center gap-2.5 whitespace-nowrap text-body-sm text-on-hero-muted">
              {counts.extension > 0 && <span className="inline-flex items-center gap-1"><ExtensionIcon className="h-3.5 w-3.5" />{counts.extension} extension</span>}
              {counts.auto > 0 && <span className="inline-flex items-center gap-1"><AutoIcon className="h-3.5 w-3.5" />{counts.auto} auto</span>}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1 sm:mt-0 sm:shrink-0">
            <button
              onClick={() => setSelectedJobs([])}
              className="h-11 whitespace-nowrap rounded-full px-4 text-body-sm font-semibold text-on-hero-muted transition-colors hover:text-on-hero focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              Clear
            </button>
            <button
              onClick={handleBatchApply}
              disabled={batchApplying}
              aria-busy={batchApplying || undefined}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-accent px-5 text-sm font-semibold text-accent-on transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-60 sm:flex-none"
            >
              {batchApplying ? "Applying…" : `Apply to ${selectedJobs.length} Jobs →`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
