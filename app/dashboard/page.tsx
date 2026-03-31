"use client";

import { useEffect, useState } from "react";
import JobCard, { Job } from "./JobCard";

export default function DashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/match")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load jobs");
        setJobs(data.jobs);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Matched Jobs
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Top matches based on your CV
          </p>
        </div>
        {!loading && !error && (
          <span className="text-sm text-gray-400">{jobs.length} results</span>
        )}
      </div>

      {loading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-white border rounded-xl p-5 animate-pulse"
            >
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/3 mb-4" />
              <div className="h-3 bg-gray-100 rounded w-full mb-1" />
              <div className="h-3 bg-gray-100 rounded w-4/5" />
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
          No matches found. Make sure your CV is uploaded and jobs have been
          scraped recently.
        </div>
      )}

      {!loading && !error && jobs.length > 0 && (
        <div className="space-y-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
