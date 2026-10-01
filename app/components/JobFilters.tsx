"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { heroControlStyles, ChevronDownIcon, FilterIcon } from "@/app/components/ui";

export type SortBy = "score" | "newest" | "salary";
export type WorkType = "remote" | "hybrid" | "onsite";
export type JobType = "full-time" | "contract" | "part-time";
export type DaysPosted = "any" | "1" | "3" | "7";

export interface Filters {
  sortBy: SortBy;
  workTypes: WorkType[];
  jobTypes: JobType[];
  daysPosted: DaysPosted;
  minSalary: string;
}

export const DEFAULT_FILTERS: Filters = {
  sortBy: "score",
  workTypes: [],
  jobTypes: [],
  daysPosted: "any",
  minSalary: "",
};

function isDefault(filters: Filters): boolean {
  return (
    filters.sortBy === DEFAULT_FILTERS.sortBy &&
    filters.workTypes.length === 0 &&
    filters.jobTypes.length === 0 &&
    filters.daysPosted === "any" &&
    filters.minSalary === ""
  );
}

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  matchCount?: number;
  totalCount?: number;
}

// Sits on the Matches hero band (navy in both themes), so it uses the
// on-hero colours rather than surface tokens.
const LABEL = "mb-1.5 block text-caption font-medium text-on-hero-muted";

const SELECT = cn(heroControlStyles({ size: "custom" }), "h-10 w-full cursor-pointer appearance-none pl-3.5 pr-9 text-sm font-medium");

function Chevron() {
  return <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-on-hero-muted" />;
}

export default function JobFilters({ filters, onChange, matchCount, totalCount }: Props) {
  const [open, setOpen] = useState(false);
  const dirty = !isDefault(filters);

  const bar = (
    <div>
      {/* Filters row */}
      <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        {/* Sort */}
        <div className="col-span-2 sm:col-span-1 sm:w-auto">
          <label htmlFor="filter-sort" className={LABEL}>Sort</label>
          <div className="relative">
            <select
              id="filter-sort"
              value={filters.sortBy}
              onChange={(e) => onChange({ ...filters, sortBy: e.target.value as SortBy })}
              className={cn(SELECT, "sm:min-w-[9rem]")}
            >
              <option value="score">Best match</option>
              <option value="newest">Newest first</option>
              <option value="salary">Salary: high to low</option>
            </select>
            <Chevron />
          </div>
        </div>

        {/* Work type */}
        <div className="w-full sm:w-auto">
          <label htmlFor="filter-work" className={LABEL}>Work type</label>
          <div className="relative">
            <select
              id="filter-work"
              value={filters.workTypes[0] ?? ""}
              onChange={(e) => {
                const v = e.target.value as WorkType | "";
                onChange({ ...filters, workTypes: v ? [v] : [] });
              }}
              className={cn(SELECT, "sm:min-w-[9rem]")}
            >
              <option value="">All types</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
            <Chevron />
          </div>
        </div>

        {/* Job type */}
        <div className="w-full sm:w-auto">
          <label htmlFor="filter-job" className={LABEL}>Job type</label>
          <div className="relative">
            <select
              id="filter-job"
              value={filters.jobTypes[0] ?? ""}
              onChange={(e) => {
                const v = e.target.value as JobType | "";
                onChange({ ...filters, jobTypes: v ? [v] : [] });
              }}
              className={cn(SELECT, "sm:min-w-[9rem]")}
            >
              <option value="">All types</option>
              <option value="full-time">Full-time</option>
              <option value="contract">Contract</option>
              <option value="part-time">Part-time</option>
            </select>
            <Chevron />
          </div>
        </div>

        {/* Date posted */}
        <div className="w-full sm:w-auto">
          <label htmlFor="filter-posted" className={LABEL}>Date posted</label>
          <div className="relative">
            <select
              id="filter-posted"
              value={filters.daysPosted}
              onChange={(e) => onChange({ ...filters, daysPosted: e.target.value as DaysPosted })}
              className={cn(SELECT, "sm:min-w-[9rem]")}
            >
              <option value="any">Any time</option>
              <option value="1">Last 24 hours</option>
              <option value="3">Last 3 days</option>
              <option value="7">Last week</option>
            </select>
            <Chevron />
          </div>
        </div>

        {/* Min salary */}
        <div className="w-full sm:w-auto">
          <label htmlFor="filter-min-salary" className={LABEL}>Min salary</label>
          <input
            id="filter-min-salary"
            type="number"
            placeholder="₪ Amount"
            value={filters.minSalary}
            onChange={(e) => onChange({ ...filters, minSalary: e.target.value })}
            className={cn(heroControlStyles(), "w-full sm:w-[8.5rem]")}
          />
        </div>

        {/* Spacer + clear filters */}
        <div className="hidden sm:block sm:flex-1 sm:min-w-0" />
        {dirty && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="flex h-10 items-center gap-2 self-end whitespace-nowrap rounded-control px-2 text-body-sm font-semibold text-on-hero underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-on-hero" />
            Clear filters
          </button>
        )}
      </div>

      {/* Count row — right-aligned below filters */}
      {totalCount !== undefined && matchCount !== undefined && (
        <div className="mt-3 flex justify-end">
          <span className="text-body-sm text-on-hero-muted" aria-live="polite">
            Showing {matchCount} of {totalCount} matches
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full">
      {/* Mobile toggle */}
      <div className="mb-3 flex items-center justify-between sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(heroControlStyles(), "inline-flex items-center gap-2 font-semibold")}
        >
          <FilterIcon />
          Filters
          {dirty && <span aria-label="(active)" className="h-1.5 w-1.5 rounded-full bg-on-hero" />}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="h-10 rounded-control px-2 text-body-sm font-semibold text-on-hero underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            Clear
          </button>
        )}
      </div>

      <div className={`${open ? "block" : "hidden"} sm:block`}>{bar}</div>
    </div>
  );
}
