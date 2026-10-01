"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CVScoreCard from "@/app/components/CVScoreCard";
import {
  DownloadIcon,
  PageHero,
  Skeleton,
  Spinner,
  StatePanel,
  UploadIcon,
  buttonStyles,
  heroControlStyles,
} from "@/app/components/ui";
import { cn } from "@/lib/cn";

const SECTION_HEADERS = new Set([
  "summary", "work experience", "experience", "education",
  "skills", "languages", "projects", "certifications",
]);

// Mirrors the generated .docx: name, contact line, brand-coloured section
// rules. Calibri (Carlito as its metric-compatible stand-in) so line breaks
// look like the downloaded file.
function CVPreview({ cvText }: { cvText: string }) {
  const lines = cvText.split("\n");
  let nameWritten = false;
  let contactWritten = false;

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400;1,700&display=swap');`}</style>
      <div className="text-[13px] leading-relaxed text-ink" style={{ fontFamily: "Calibri, Carlito, Arial, sans-serif" }}>
        {lines.map((line, i) => {
          const trimmed = line.trim();
          if (!nameWritten && trimmed) {
            nameWritten = true;
            return <div key={i} className="mb-1 text-center text-lg font-bold text-brand-text">{trimmed}</div>;
          }
          if (nameWritten && !contactWritten && trimmed) {
            contactWritten = true;
            return <div key={i} className="mb-5 text-center text-xs text-ink-muted">{trimmed}</div>;
          }
          if (SECTION_HEADERS.has(trimmed.toLowerCase().replace(/:$/, ""))) {
            return (
              <div key={i} className="mb-1.5 mt-5 border-b border-brand/40 pb-0.5 text-xs font-bold uppercase tracking-wider text-brand-text">
                {trimmed.replace(/:$/, "")}
              </div>
            );
          }
          if (trimmed.startsWith("•")) return <div key={i} className="pl-4 text-ink">{trimmed}</div>;
          if (!trimmed) return <div key={i} className="h-2" />;
          return <div key={i} className="text-ink">{trimmed}</div>;
        })}
      </div>
    </>
  );
}

const cardCls = "rounded-[1.375rem] bg-surface-raised shadow-dossier ring-1 ring-line/60";

export default function MyCVPage() {
  const [cvText, setCvText] = useState<string | null>(null);
  const [cvId, setCvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  function loadCV() {
    setLoading(true);
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d.cv?.raw_text) {
          setCvText(d.cv.raw_text);
          setCvId(d.cv.id ?? null);
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadCV(); }, []);

  async function handleDownload() {
    if (!cvId) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/cv/download-generated?cv_id=${cvId}`);
      if (!res.ok) return;
      // Could be the user's own uploaded file (any extension) or our
      // generated .docx — take the real filename from the response rather
      // than assuming .docx.
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameMatch?.[1] ?? "My_CV.docx";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const heroAction = cn(heroControlStyles({ size: "custom" }), "inline-flex h-10 items-center gap-2 px-4 text-sm font-semibold");

  const hero = (
    <PageHero
      title="Your CV"
      subtitle={cvText ? "What employers receive, and how to make it stronger." : undefined}
      meta={
        cvText && (
          <>
            <Link href="/dashboard/onboarding" className={heroAction}>
              <UploadIcon className="h-4 w-4" />
              Replace CV
            </Link>
            {cvId && (
              <button type="button" onClick={handleDownload} disabled={downloading} className={heroAction}>
                {downloading ? <Spinner size="sm" decorative /> : <DownloadIcon className="h-4 w-4" />}
                {downloading ? "Preparing…" : "Download CV"}
              </button>
            )}
          </>
        )
      }
    />
  );

  if (loading) {
    return (
      <div className="w-full" aria-busy="true">
        {hero}
        <div className="relative mx-auto -mt-14 grid max-w-6xl gap-6 sm:-mt-16 lg:grid-cols-3">
          <div className={cn(cardCls, "p-6 sm:p-10 lg:col-span-2")}>
            <Skeleton className="mx-auto h-5 w-1/3" />
            <Skeleton className="mx-auto mt-2 h-3 w-1/2" />
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="mt-4 h-3 w-full" />)}
          </div>
          <div className={cn(cardCls, "h-64 p-6")}><Skeleton className="h-24 w-24 rounded-full" /></div>
        </div>
        <span className="sr-only" role="status">Loading your CV</span>
      </div>
    );
  }

  if (!cvText) {
    return (
      <div className="w-full">
        {hero}
        <div className="relative mx-auto -mt-14 max-w-2xl sm:-mt-16">
          <StatePanel
            title="You haven't added a CV yet"
            action={<Link href="/dashboard/onboarding" className={buttonStyles({ size: "lg" })}>Upload or build a CV</Link>}
          >
            Your matches are ranked against your CV, so this is the first thing to set up.
          </StatePanel>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {hero}
      <div className="relative mx-auto -mt-14 grid max-w-6xl items-start gap-6 pb-10 sm:-mt-16 lg:grid-cols-3">
        {/* Score first in the DOM so it sits above the CV on phones */}
        <div className="lg:sticky lg:top-6 lg:order-2">
          <CVScoreCard onImproved={(id) => { setCvId(id); loadCV(); }} />
        </div>

        <section aria-label="CV preview" className={cn(cardCls, "overflow-hidden lg:order-1 lg:col-span-2")}>
          <div className="max-h-[75vh] overflow-y-auto px-6 py-8 sm:px-12 sm:py-12">
            <CVPreview cvText={cvText} />
          </div>
        </section>
      </div>
    </div>
  );
}
