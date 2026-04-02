"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface SavedJob {
  id: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  salary_min: number | null;
  salary_max: number | null;
  scraped_at: string;
}

export default function SavedJobsPage() {
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/jobs/saved")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load saved jobs");
        setJobs(data.jobs);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Saved Jobs</h1>
          <p className="text-sm text-gray-500 mt-0.5">Jobs you bookmarked for later</p>
        </div>
        {!loading && !error && (
          <span className="text-sm text-gray-400">{jobs.length} saved</span>
        )}
      </div>

      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white border rounded-xl p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="bg-white border rounded-xl p-10 text-center text-gray-500 text-sm">
          No saved jobs yet.{" "}
          <a href="/dashboard" className="text-blue-600 hover:underline">
            Browse matched jobs
          </a>{" "}
          and click Save on any listing.
        </div>
      )}

      {!loading && !error && jobs.length > 0 && (
        <div className="space-y-3">
          {jobs.map((job) => {
            const salary =
              job.salary_min && job.salary_max
                ? `₪${job.salary_min.toLocaleString()} – ₪${job.salary_max.toLocaleString()}`
                : job.salary_min
                ? `From ₪${job.salary_min.toLocaleString()}`
                : null;

            return (
              <div key={job.id} className="bg-white border rounded-xl p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{job.title}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {job.company}
                      {job.location ? ` · ${job.location}` : ""}
                    </p>
                    {salary && <p className="text-xs text-gray-400 mt-0.5">{salary}</p>}
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                    {new Date(job.scraped_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </div>
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
