"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/app/components/Toast";

export interface Job {
  id: string;
  title: string;
  company: string;
  description: string;
  location: string;
  url: string;
  salary_min: number | null;
  salary_max: number | null;
  scraped_at: string;
  similarity: number;
  claude_score: number;
  reasons: string[];
  gaps: string[];
}

export default function JobCard({ job, initialSaved = false, onDismiss }: { job: Job; initialSaved?: boolean; onDismiss?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(initialSaved);
  const [saving, setSaving] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const router = useRouter();

  // Fall back to vector similarity when Claude scoring didn't run
  const score = job.claude_score > 0
    ? job.claude_score
    : Math.round(job.similarity * 100);
  const scoreColor =
    score >= 80
      ? "bg-green-100 text-green-800"
      : score >= 60
      ? "bg-yellow-100 text-yellow-800"
      : "bg-gray-100 text-gray-600";

  const salary =
    job.salary_min && job.salary_max
      ? `₪${job.salary_min.toLocaleString()} – ₪${job.salary_max.toLocaleString()}`
      : job.salary_min
      ? `From ₪${job.salary_min.toLocaleString()}`
      : null;

  async function handleDismiss() {
    setDismissing(true);
    try {
      await fetch("/api/jobs/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: job.id, action: "dismissed" }),
      });
      // Let the fade complete before removing from list
      setTimeout(() => onDismiss?.(job.id), 300);
    } catch {
      setDismissing(false);
    }
  }

  return (
    <div
      className={`bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-300 ${
        dismissing ? "opacity-0 scale-95" : "opacity-100"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{job.title}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {job.company}
            {job.location ? ` · ${job.location}` : ""}
          </p>
          {salary && (
            <p className="text-xs text-gray-400 mt-0.5">{salary}</p>
          )}
        </div>
        <span
          className={`shrink-0 text-sm font-semibold px-2.5 py-1 rounded-full ${scoreColor}`}
        >
          {score}%
        </span>
      </div>

      {/* Description preview */}
      {job.description && (
        <p className="text-sm text-gray-600 mt-3 line-clamp-2">
          {job.description}
        </p>
      )}

      {/* Expand toggle */}
      <button
        className="text-xs text-blue-600 mt-2 hover:underline focus:outline-none"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Show less" : "Show more"}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {job.reasons.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 mb-1">
                Why it fits
              </p>
              <ul className="space-y-0.5">
                {job.reasons.map((r, i) => (
                  <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                    <span className="text-green-500 shrink-0">✓</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {job.gaps.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-700 mb-1">Gaps</p>
              <ul className="space-y-0.5">
                {job.gaps.map((g, i) => (
                  <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                    <span className="text-amber-400 shrink-0">!</span>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {job.description && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">
                Full description
              </p>
              <p className="text-xs text-gray-600 whitespace-pre-line">
                {job.description}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 flex items-center gap-3">
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
        >
          View job
        </a>
        <button
          onClick={() => router.push(`/dashboard/apply/${job.id}`)}
          className="text-xs font-medium bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors"
        >
          Apply
        </button>
        <button
          disabled={saving}
          onClick={async () => {
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
          }}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
            saved
              ? "bg-gray-100 text-gray-500 border-gray-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200"
              : "hover:bg-gray-50 text-gray-600 border-gray-300"
          }`}
        >
          {saving ? "…" : saved ? "Saved ✓" : "Save"}
        </button>
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50 ml-auto"
        >
          Not interested
        </button>
      </div>
    </div>
  );
}
