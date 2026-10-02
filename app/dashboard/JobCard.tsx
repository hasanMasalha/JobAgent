"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/app/components/Toast";
import { JobDescription } from "./components/JobDescription";
import { cn } from "@/lib/cn";
import { DIRECT_APPLY_ATS_DOMAINS, isLinkedInListing } from "@/lib/detect-apply-type";
import {
  Badge,
  Button,
  buttonStyles,
  ScoreRing,
  Spinner,
  DirectIcon,
  ExtensionIcon,
  AutoIcon,
  ExternalIcon,
  ArrowRightIcon,
  PenIcon,
  BookmarkIcon,
  FitMark,
  GapMark,
} from "@/app/components/ui";

const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? ""

function useExtensionInstalled() {
  const [installed, setInstalled] = useState(false)
  useEffect(() => {
    if (!EXTENSION_ID || typeof chrome === "undefined" || !chrome?.runtime?.sendMessage) return
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type: "PING" }, () => {
        setInstalled(!chrome.runtime.lastError)
      })
    } catch {
      // not installed
    }
  }, [])
  return installed
}

export interface Job {
  id: string;
  title: string;
  company: string;
  description: string;
  location: string | null;
  url: string;
  source?: string;
  apply_type?: string;
  recruiter_email?: string | null;
  salary_min: number | null;
  salary_max: number | null;
  scraped_at: string;
  similarity?: number;
  claude_score?: number;
  reasons?: string[];
  gaps?: string[];
}

interface Props {
  job: Job;
  initialSaved?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onApply?: (id: string) => void;
  showScore?: boolean;
  showSource?: boolean;
  /** The one job given the large card at the top of a list. */
  variant?: "default" | "featured";
  /** Eyebrow on the featured card, e.g. "Top match" — depends on the sort. */
  featuredLabel?: string;
}

const ATS_URL_PATTERNS = ["greenhouse.io", "lever.co", "workable.com", "ashbyhq.com"] as const;
function isATSJob(url?: string): boolean {
  return ATS_URL_PATTERNS.some((p) => (url ?? "").toLowerCase().includes(p));
}

// LinkedIn Easy Apply sends the résumé on the user's LinkedIn profile, so a
// tailored CV is only useful there as a download.
function isLinkedInOnly(job: Job): boolean {
  return isLinkedInListing(job.url);
}

// Whether the card's Apply button does something: a job on an ATS we submit
// to, or a LinkedIn listing the scraper confirmed as Easy Apply
// (apply_type "extension"). A LinkedIn listing that isn't confirmed is
// external like any other — no Apply that opens LinkedIn only to find there
// is nothing to automate.
function isAutoApplicable(job: Job): boolean {
  if (job.apply_type === "external") return false;
  const url = (job.url || "").toLowerCase();
  return DIRECT_APPLY_ATS_DOMAINS.some((d) => url.includes(d)) || job.apply_type === "extension";
}

export function ApplyTypeBadge({ type, url }: { type: string; url?: string }) {
  if (type === "auto" && isATSJob(url))
    return (
      <span title="JobAgent will submit your application directly to the company ATS">
        <Badge tone="success"><DirectIcon className="h-3.5 w-3.5" />Direct Apply</Badge>
      </span>
    );
  if (type === "extension")
    return <Badge tone="info"><ExtensionIcon className="h-3.5 w-3.5" />Extension</Badge>;
  if (type === "auto")
    return <Badge tone="success"><AutoIcon className="h-3.5 w-3.5" />Auto Apply</Badge>;
  return <Badge tone="neutral"><ExternalIcon className="h-3.5 w-3.5" />External</Badge>;
}

function daysAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000);
  if (mins < 60) return "just now";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function SourcePill({ source }: { source: string }) {
  const s = source.toLowerCase();
  if (s === "indeed") return <Badge tone="info">Indeed</Badge>;
  if (s === "linkedin") return <Badge tone="brand">LinkedIn</Badge>;
  return <Badge tone="success">Company</Badge>;
}

/** Horizontal score for ordinary cards: serif figure + hairline bar. */
function InlineScore({ score }: { score: number }) {
  const strong = score >= 80;
  const word = strong ? "Strong match" : score >= 60 ? "Good match" : "Partial match";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3" title={`${word}: ${score}%`}>
      <span className="sr-only">{`${word}, ${score} percent`}</span>
      <span aria-hidden="true" className="numerals w-14 shrink-0 font-serif text-[1.625rem] font-medium leading-none text-ink">
        {score}
        <span className="align-top text-sm">%</span>
      </span>
      <span aria-hidden="true" className="h-1 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-surface-sunken">
        <span
          className={cn("block h-full rounded-full transition-[width] duration-700 ease-calm", strong ? "bg-accent" : score >= 60 ? "bg-brand" : "bg-ink-subtle/60")}
          style={{ width: `${score}%` }}
        />
      </span>
    </div>
  );
}

export default function JobCard({
  job,
  initialSaved = false,
  selected = false,
  onSelect,
  onDismiss,
  onApply,
  showScore = true,
  showSource = false,
  variant = "default",
  featuredLabel,
}: Props) {
  const [saved, setSaved] = useState(initialSaved);
  const [saving, setSaving] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [quickApplying, setQuickApplying] = useState(false);
  const [quickApplied, setQuickApplied] = useState(false);
  const router = useRouter();
  useExtensionInstalled();

  const score =
    (job.claude_score ?? 0) > 0
      ? job.claude_score!
      : Math.round((job.similarity ?? 0) * 100);

  const salary =
    job.salary_min && job.salary_max
      ? `₪${job.salary_min.toLocaleString()} – ₪${job.salary_max.toLocaleString()}`
      : job.salary_min
      ? `From ₪${job.salary_min.toLocaleString()}`
      : null;

  const handleQuickApply = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (quickApplying || quickApplied) return;
    // LinkedIn Easy Apply: nothing to submit from here. The review screen shows
    // what LinkedIn will receive; Confirm there hands over to the extension.
    if (isLinkedInOnly(job) && job.apply_type === "extension") {
      router.push(`/dashboard/apply/${job.id}`);
      return;
    }
    setQuickApplying(true);
    try {
      const res = await fetch("/api/apply/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (res.status === 403 && data.error === "limit_reached") {
        showToast("You've reached your monthly auto-apply limit. Upgrade on the Pricing page for more.", "error");
        return;
      }
      if (data.needs_extension) {
        router.push(`/dashboard/apply/${job.id}`);
        return;
      }
      if (data.status === "external") {
        window.open(data.external_url, "_blank");
        setQuickApplied(true);
        showToast("Job opened — apply on their website", "success");
        return;
      }
      if (data.status === "applying") {
        setQuickApplied(true);
        showToast(
          `Submitting to ${job.company}… check the Applications page for status.`,
          "success"
        );
        return;
      }
      const errMsg = (data.error as string) || "Apply failed";
      showToast(`${errMsg} — use Tailor & Download to apply manually.`, "error");
    } catch {
      showToast("Apply failed", "error");
    } finally {
      setQuickApplying(false);
    }
  };

  const handleTailorApply = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onApply?.(job.id);
    const download = !isAutoApplicable(job) || isLinkedInOnly(job);
    router.push(`/dashboard/apply/${job.id}${download ? "?mode=download" : ""}`);
  };

  async function handleDismiss() {
    setDismissing(true);
    try {
      await fetch("/api/jobs/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: job.id, action: "dismissed" }),
      });
      setTimeout(() => onDismiss?.(job.id), 300);
    } catch {
      setDismissing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (saved) {
        const res = await fetch("/api/jobs/interact", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: job.id }),
        });
        if (!res.ok) throw new Error("Failed to unsave");
        setSaved(false);
        showToast("Job removed from saved", "success");
      } else {
        const res = await fetch(`/api/jobs/${job.id}/save`, { method: "POST" });
        if (!res.ok) throw new Error("Failed to save");
        setSaved(true);
        showToast("Job saved", "success");
      }
    } catch {
      showToast(saved ? "Could not unsave job" : "Could not save job", "error");
    } finally {
      setSaving(false);
    }
  }

  const reasons = job.reasons ?? [];
  const gaps = job.gaps ?? [];
  const autoApplicable = isAutoApplicable(job);
  const featured = variant === "featured";
  // Brass Apply only for a strong match — the accent always means "worth it".
  const strong = showScore && score >= 80;

  const checkbox = job.apply_type && job.apply_type !== "external" && onSelect && (
    <input
      type="checkbox"
      checked={selected}
      onChange={() => onSelect(job.id)}
      onClick={(e) => e.stopPropagation()}
      className="h-5 w-5 shrink-0 cursor-pointer rounded border-line-strong accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={`Select ${job.title}`}
    />
  );

  const viewJob = (
    <a
      href={job.url}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonStyles({ variant: "ghost", size: featured ? "md" : "sm" })}
      onClick={() => {
        fetch("/api/jobs/check-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id, url: job.url }),
        }).catch(() => {})
      }}
    >
      View job
    </a>
  );

  const size = featured ? "lg" : "sm";
  const applyButton = autoApplicable ? (
    <button
      type="button"
      onClick={handleQuickApply}
      disabled={quickApplying || quickApplied}
      aria-busy={quickApplying || undefined}
      className={
        quickApplied
          ? buttonStyles({ variant: "done", size, block: featured })
          : buttonStyles({ variant: strong && featured ? "accent" : "primary", size, block: featured })
      }
    >
      {quickApplying ? (
        <><Spinner size="sm" decorative />Applying...</>
      ) : quickApplied ? (
        "✓ Submitted"
      ) : (
        <>Apply{featured && <ArrowRightIcon />}</>
      )}
    </button>
  ) : (
    <Button variant="secondary" size={size} block={featured} disabled title="Apply manually on their website">
      Apply
    </Button>
  );

  const tailorButton = (
    <Button variant="secondary" size={featured ? "lg" : "sm"} block={featured} onClick={handleTailorApply}>
      <PenIcon className="h-3.5 w-3.5" />
      {autoApplicable && !isLinkedInOnly(job) ? "Tailor CV" : "Tailor & Download"}
    </Button>
  );

  const saveButton = (
    <Button
      variant="ghost"
      size={featured ? "md" : "sm"}
      disabled={saving}
      onClick={handleSave}
      aria-pressed={saved}
    >
      <BookmarkIcon filled={saved} className="h-3.5 w-3.5" />
      {saving ? "…" : saved ? "Saved" : "Save"}
    </Button>
  );

  const dismissButton = (
    <Button variant="ghost" size={featured ? "md" : "sm"} onClick={handleDismiss} disabled={dismissing}>
      Not interested
    </Button>
  );

  const fitAndGaps = (reasons.length > 0 || gaps.length > 0) && (
    <div
      className={cn(
        "grid gap-x-8 gap-y-4",
        featured ? "mt-6 border-t border-line pt-6 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" : "mt-4",
      )}
    >
      {reasons.length > 0 && (
        <div>
          <h3 className="mb-2 text-caption font-semibold text-success-text">Why it fits</h3>
          <ul className="space-y-1.5">
            {reasons.map((r, i) => (
              <li key={i} className={cn("flex gap-2.5 text-ink", featured ? "text-body-sm sm:text-[0.9375rem] sm:leading-6" : "text-body-sm")}>
                <FitMark className="mt-0.5" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      {gaps.length > 0 && (
        <div>
          <h3 className="mb-2 text-caption font-semibold text-attention-text">Gaps</h3>
          <ul className="space-y-1.5">
            {gaps.map((g, i) => (
              <li key={i} className={cn("flex gap-2.5 text-ink", featured ? "text-body-sm sm:text-[0.9375rem] sm:leading-6" : "text-body-sm")}>
                <GapMark className="mt-0.5" />
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  const meta = (
    <>
      <span className="font-semibold text-ink">{job.company}</span>
      {job.location ? ` · ${job.location}` : ""}
    </>
  );

  if (featured) {
    return (
      <article
        aria-label={`${featuredLabel ? `${featuredLabel}: ` : ""}${job.title} at ${job.company}`}
        className={cn(
          "relative grid gap-8 rounded-[1.375rem] bg-surface-raised p-5 shadow-dossier transition-all duration-300 ease-calm",
          "motion-safe:animate-lift-in sm:p-8 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-12 lg:p-10",
          selected ? "ring-2 ring-brand" : "ring-1 ring-line/60",
          dismissing ? "scale-[0.98] opacity-0" : "opacity-100",
        )}
      >
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2.5">
              {checkbox}
              {featuredLabel && (
                <Badge tone={strong && featuredLabel === "Top match" ? "accent" : "brand"}>{featuredLabel}</Badge>
              )}
              {job.apply_type && <ApplyTypeBadge type={job.apply_type} url={job.url} />}
              {showSource && job.source && <SourcePill source={job.source} />}
              <span className="text-body-sm text-ink-subtle">{daysAgo(job.scraped_at)}</span>
            </div>
            {showScore && <ScoreRing score={score} size="md" className="-mr-1 -mt-1 lg:hidden" />}
          </div>
          <h2 className="mt-4 text-balance font-serif text-feature-sm text-ink sm:mt-5 sm:text-feature">{job.title}</h2>
          <p className="mt-2 text-body text-ink-muted sm:mt-2.5 sm:text-[1.0625rem]">
            {meta}
            {salary && <span className="block text-body-sm text-ink-subtle sm:ml-2 sm:inline sm:text-body"><span className="hidden sm:inline">· </span>{salary}</span>}
          </p>
          {job.description && <JobDescription description={job.description} />}
          {fitAndGaps}
        </div>

        <aside aria-label="Actions" className="flex flex-col gap-2.5">
          {showScore && <ScoreRing score={score} className="mb-4 hidden self-center lg:block" />}
          {applyButton}
          {tailorButton}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-1 lg:grid lg:grid-cols-1 lg:gap-0.5">
            {viewJob}
            {saveButton}
            {dismissButton}
          </div>
        </aside>
      </article>
    );
  }

  return (
    <div
      className={cn(
        "group flex h-full flex-col rounded-[1.125rem] border bg-surface p-5 sm:p-6",
        "transition-all duration-300 ease-calm hover:shadow-lift motion-safe:hover:-translate-y-0.5",
        selected ? "border-brand ring-1 ring-brand" : "border-line hover:border-line-strong/50",
        dismissing ? "scale-95 opacity-0" : "opacity-100",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-title-serif text-ink">{job.title}</h3>
          <p className="mt-1 text-body-sm text-ink-muted">{meta}</p>
        </div>
        {checkbox && <div className="pt-1">{checkbox}</div>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        {showScore ? <InlineScore score={score} /> : <span className="flex-1 text-body-sm text-ink-subtle">{daysAgo(job.scraped_at)}</span>}
        <div className="flex flex-wrap items-center gap-1.5">
          {job.apply_type && <ApplyTypeBadge type={job.apply_type} url={job.url} />}
          {showSource && job.source && <SourcePill source={job.source} />}
        </div>
      </div>
      {salary && <p className="mt-2 text-body-sm text-ink-subtle">{salary}</p>}

      {job.description && <JobDescription description={job.description} lines={2} />}
      {fitAndGaps}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        {applyButton}
        {tailorButton}
        {viewJob}
        <div className="ml-auto flex items-center">
          {saveButton}
          {dismissButton}
        </div>
      </div>
    </div>
  );
}
