"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHero, SkeletonCard, StatePanel, buttonStyles } from "@/app/components/ui";
import { cn } from "@/lib/cn";

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

const cardCls = "rounded-[1.375rem] bg-surface-raised shadow-dossier ring-1 ring-line/60";

export default function SavedJobsPage() {
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="w-full">
      <PageHero
        title="Saved jobs"
        subtitle="Jobs you bookmarked to come back to."
        meta={!loading && !error && (
          <span className="text-body-sm text-on-hero-muted">{jobs.length} saved</span>
        )}
      />

      <div className="relative mx-auto -mt-14 max-w-3xl pb-24 sm:-mt-16 sm:pb-10">
        {loading && (
          <div className="space-y-3" aria-busy="true">
            <SkeletonCard /><SkeletonCard /><SkeletonCard />
            <span className="sr-only" role="status">Loading saved jobs</span>
          </div>
        )}

        {error && <StatePanel role="alert" title="Couldn't load your saved jobs">{error}</StatePanel>}

        {!loading && !error && jobs.length === 0 && (
          <StatePanel
            title="Nothing saved yet"
            action={<Link href="/dashboard/matches" className={buttonStyles({ size: "lg" })}>See your matches</Link>}
          >
            Save any job from your matches and it waits here until you&apos;re ready to apply.
          </StatePanel>
        )}

        {!loading && !error && jobs.length > 0 && (
          <ul className="space-y-3">
            {jobs.map((job) => {
              const salary =
                job.salary_min && job.salary_max
                  ? `₪${job.salary_min.toLocaleString()} – ₪${job.salary_max.toLocaleString()}`
                  : job.salary_min
                  ? `From ₪${job.salary_min.toLocaleString()}`
                  : null;

              return (
                <li key={job.id} className={cn(cardCls, "p-5 sm:p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-title-card text-ink">{job.title}</h2>
                      <p className="mt-0.5 text-body-sm text-ink-muted">
                        {job.company}
                        {job.location ? ` · ${job.location}` : ""}
                      </p>
                      {salary && <p className="mt-1 text-body-sm text-ink-subtle tabular-nums">{salary}</p>}
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-caption text-ink-subtle">
                      Listed {new Date(job.scraped_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/apply/${job.id}`} className={buttonStyles({ size: "sm" })}>
                      Tailor CV &amp; apply
                    </Link>
                    <a href={job.url} target="_blank" rel="noopener noreferrer" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                      View job <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
