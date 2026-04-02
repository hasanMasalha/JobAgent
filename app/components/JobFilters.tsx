"use client";

import { useEffect, useRef, useState } from "react";

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
}

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: T[];
  selected: T[];
  onChange: (val: T[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const display =
    selected.length === 0
      ? label
      : selected.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(", ");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors whitespace-nowrap ${
          selected.length > 0
            ? "border-gray-900 text-gray-900 font-medium"
            : "border-gray-300 text-gray-600"
        }`}
        style={{ minWidth: 120 }}
      >
        <span className="truncate max-w-[140px]">{display}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 min-w-[140px]">
          {options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => onChange(toggle(selected, opt))}
                className="accent-gray-900"
              />
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function JobFilters({ filters, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const dirty = !isDefault(filters);

  const bar = (
    <div className="flex flex-wrap items-center gap-4">
      {/* Sort */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Sort</span>
        <select
          value={filters.sortBy}
          onChange={(e) => onChange({ ...filters, sortBy: e.target.value as SortBy })}
          style={{ width: 160 }}
          className="text-xs border border-gray-300 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          <option value="score">Best match</option>
          <option value="newest">Newest first</option>
          <option value="salary">Salary: high to low</option>
        </select>
      </div>

      {/* Work type */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Work type</span>
        <MultiSelect
          label="Remote"
          options={["remote", "hybrid", "onsite"] as WorkType[]}
          selected={filters.workTypes}
          onChange={(v) => onChange({ ...filters, workTypes: v as WorkType[] })}
        />
      </div>

      {/* Job type */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Job type</span>
        <MultiSelect
          label="All types"
          options={["full-time", "contract", "part-time"] as JobType[]}
          selected={filters.jobTypes}
          onChange={(v) => onChange({ ...filters, jobTypes: v as JobType[] })}
        />
      </div>

      {/* Date posted */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Date posted</span>
        <select
          value={filters.daysPosted}
          onChange={(e) => onChange({ ...filters, daysPosted: e.target.value as DaysPosted })}
          className="text-xs border border-gray-300 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          <option value="any">Any time</option>
          <option value="1">Last 24 hours</option>
          <option value="3">Last 3 days</option>
          <option value="7">Last 7 days</option>
        </select>
      </div>

      {/* Min salary */}
      <input
        type="number"
        placeholder="Min salary (₪)"
        value={filters.minSalary}
        onChange={(e) => onChange({ ...filters, minSalary: e.target.value })}
        style={{ width: 140 }}
        className="text-xs border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gray-400"
      />

      {/* Clear */}
      {dirty && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="text-xs text-blue-600 hover:underline whitespace-nowrap"
        >
          Clear filters
        </button>
      )}
    </div>
  );

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-gray-100 py-3 px-4 -mx-6">
      {/* Mobile toggle */}
      <div className="sm:hidden flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700 border border-gray-300 bg-white rounded-lg px-3 py-1.5"
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
      {/* Mobile expanded / desktop always visible */}
      <div className={`${open ? "mt-3" : "hidden"} sm:block`}>
        {bar}
      </div>
    </div>
  );
}
