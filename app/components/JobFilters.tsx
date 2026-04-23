"use client";

import { useState } from "react";

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

const LABEL = "block text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5";

const SELECT =
  "appearance-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 pr-8 text-sm font-medium " +
  "text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 " +
  "focus:outline-none cursor-pointer transition-colors";

function Chevron() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const Divider = () => <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 shrink-0 self-end mb-0.5" />;

export default function JobFilters({ filters, onChange, matchCount, totalCount }: Props) {
  const [open, setOpen] = useState(false);
  const dirty = !isDefault(filters);

  const bar = (
    <div className="flex flex-wrap items-end gap-3">
      {/* Sort */}
      <div>
        <span className={LABEL}>Sort</span>
        <div className="relative">
          <select
            value={filters.sortBy}
            onChange={(e) => onChange({ ...filters, sortBy: e.target.value as SortBy })}
            className={`${SELECT} min-w-[140px]`}
          >
            <option value="score">Best match</option>
            <option value="newest">Newest first</option>
            <option value="salary">Salary: high to low</option>
          </select>
          <Chevron />
        </div>
      </div>

      <Divider />

      {/* Work type */}
      <div>
        <span className={LABEL}>Work type</span>
        <div className="relative">
          <select
            value={filters.workTypes[0] ?? ""}
            onChange={(e) => {
              const v = e.target.value as WorkType | "";
              onChange({ ...filters, workTypes: v ? [v] : [] });
            }}
            className={`${SELECT} min-w-[130px]`}
          >
            <option value="">All types</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </select>
          <Chevron />
        </div>
      </div>

      <Divider />

      {/* Job type */}
      <div>
        <span className={LABEL}>Job type</span>
        <div className="relative">
          <select
            value={filters.jobTypes[0] ?? ""}
            onChange={(e) => {
              const v = e.target.value as JobType | "";
              onChange({ ...filters, jobTypes: v ? [v] : [] });
            }}
            className={`${SELECT} min-w-[130px]`}
          >
            <option value="">All types</option>
            <option value="full-time">Full-time</option>
            <option value="contract">Contract</option>
            <option value="part-time">Part-time</option>
          </select>
          <Chevron />
        </div>
      </div>

      <Divider />

      {/* Date posted */}
      <div>
        <span className={LABEL}>Date posted</span>
        <div className="relative">
          <select
            value={filters.daysPosted}
            onChange={(e) => onChange({ ...filters, daysPosted: e.target.value as DaysPosted })}
            className={`${SELECT} min-w-[130px]`}
          >
            <option value="any">Any time</option>
            <option value="1">Last 24 hours</option>
            <option value="3">Last 3 days</option>
            <option value="7">Last week</option>
          </select>
          <Chevron />
        </div>
      </div>

      <Divider />

      {/* Min salary */}
      <div>
        <span className={LABEL}>Min salary</span>
        <input
          type="number"
          placeholder="₪ Amount"
          value={filters.minSalary}
          onChange={(e) => onChange({ ...filters, minSalary: e.target.value })}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-600 w-[140px] hover:border-gray-400 dark:hover:border-gray-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none transition-colors"
        />
      </div>

      {/* Spacer pushes right side to the end */}
      <div className="flex-1 min-w-0" />

      {/* Right side: count + clear */}
      <div className="flex items-end gap-4">
        {totalCount !== undefined && matchCount !== undefined && (
          <span className="text-sm text-gray-400 whitespace-nowrap pb-2">
            Showing {matchCount} of {totalCount} matches
          </span>
        )}
        {dirty && (
          <div>
            <span className={LABEL}>&nbsp;</span>
            <button
              type="button"
              onClick={() => onChange(DEFAULT_FILTERS)}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap transition-colors py-2"
            >
              <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm px-5 py-4 mb-6">
      {/* Mobile toggle */}
      <div className="sm:hidden flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM9 15a1 1 0 011-1h6a1 1 0 110 2h-6a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
          Filters
          {dirty && <span className="ml-1 w-2 h-2 rounded-full bg-blue-500 inline-block" />}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="text-xs text-blue-600 hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      <div className={`${open ? "block" : "hidden"} sm:block`}>{bar}</div>
    </div>
  );
}
