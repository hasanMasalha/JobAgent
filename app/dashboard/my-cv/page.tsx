"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CVPreview from "@/app/components/CVPreview";
import CVScoreCard from "@/app/components/CVScoreCard";
import { showToast } from "@/app/components/Toast";
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
import type { CvFormat } from "@/lib/cv-file";
import { downloadFile } from "@/lib/download-file";

const cardCls = "rounded-[1.375rem] bg-surface-raised shadow-dossier ring-1 ring-line/60";

export default function MyCVPage() {
  const [cvText, setCvText] = useState<string | null>(null);
  const [cvId, setCvId] = useState<string | null>(null);
  // The user's own upload comes back as the file they gave us, so there's
  // no PDF/Word choice to offer for it.
  const [ownFile, setOwnFile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<CvFormat | null>(null);

  function loadCV() {
    setLoading(true);
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d.cv?.raw_text) {
          setCvText(d.cv.raw_text);
          setCvId(d.cv.id ?? null);
          setOwnFile(d.cv.source === "uploaded" && Boolean(d.cv.has_original_file));
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadCV(); }, []);

  async function handleDownload(format: CvFormat) {
    if (!cvId) return;
    setDownloading(format);
    try {
      await downloadFile(`/api/cv/download-generated?cv_id=${cvId}&format=${format}`, `My_CV.${format}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Download failed", "error");
    } finally {
      setDownloading(null);
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
              <button type="button" onClick={() => handleDownload("pdf")} disabled={downloading !== null} className={heroAction}>
                {downloading === "pdf" ? <Spinner size="sm" decorative /> : <DownloadIcon className="h-4 w-4" />}
                {downloading === "pdf" ? "Preparing…" : ownFile ? "Download CV" : "Download PDF"}
              </button>
            )}
            {cvId && !ownFile && (
              <button type="button" onClick={() => handleDownload("docx")} disabled={downloading !== null} className={heroAction}>
                {downloading === "docx" ? "Preparing…" : "Word (.docx)"}
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
          <div className="max-h-[75vh] overflow-y-auto bg-white px-6 py-8 sm:px-12 sm:py-12">
            <CVPreview cvText={cvText} />
          </div>
        </section>
      </div>
    </div>
  );
}
