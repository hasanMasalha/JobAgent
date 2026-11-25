"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import CVPreview from "@/app/components/CVPreview";
import CVScoreCard from "@/app/components/CVScoreCard";
import { showToast } from "@/app/components/Toast";
import { DownloadIcon, PageHero, Skeleton, Spinner, StatePanel, buttonStyles, heroControlStyles } from "@/app/components/ui";
import { cn } from "@/lib/cn";
import type { CvFormat } from "@/lib/cv-file";
import { downloadFile } from "@/lib/download-file";

function PreviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cvId = searchParams.get("cv_id");

  const [cvText, setCvText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<CvFormat | null>(null);

  useEffect(() => {
    if (!cvId) {
      router.replace("/dashboard/cv-builder");
      return;
    }
    fetch(`/api/cv/${cvId}/text`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setCvText(d.raw_text);
      })
      .catch((err) => setError(err.message ?? "Failed to load CV"))
      .finally(() => setLoading(false));
  }, [cvId, router]);

  async function handleDownload(format: CvFormat) {
    setDownloading(format);
    try {
      await downloadFile(`/api/cv/download-generated?cv_id=${cvId}&format=${format}`, `My_CV.${format}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Download failed. Try again.", "error");
    } finally {
      setDownloading(null);
    }
  }

  const heroAction = cn(heroControlStyles({ size: "custom" }), "inline-flex h-10 items-center gap-2 px-4 text-sm font-semibold");
  const hero = (
    <PageHero
      title="Your CV is ready"
      subtitle={cvText ? "Read it through, then download it or head to your matches." : undefined}
      meta={cvText && (
        <>
          <Link href="/dashboard/cv-builder" className={heroAction}>Edit answers</Link>
          <button type="button" onClick={() => handleDownload("pdf")} disabled={downloading !== null} className={heroAction}>
            {downloading === "pdf" ? <Spinner size="sm" decorative /> : <DownloadIcon className="h-4 w-4" />}
            {downloading === "pdf" ? "Preparing…" : "Download PDF"}
          </button>
          <button type="button" onClick={() => handleDownload("docx")} disabled={downloading !== null} className={heroAction}>
            {downloading === "docx" ? "Preparing…" : "Word (.docx)"}
          </button>
        </>
      )}
    />
  );

  if (loading) {
    return (
      <div className="w-full" aria-busy="true">
        {hero}
        <div className="relative mx-auto -mt-14 max-w-6xl sm:-mt-16">
          <div className={cn(cardCls, "p-6 sm:p-10 lg:w-2/3")}>
            <Skeleton className="mx-auto h-5 w-1/3" />
            <Skeleton className="mx-auto mt-2 h-3 w-1/2" />
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="mt-4 h-3 w-full" />)}
          </div>
        </div>
        <span className="sr-only" role="status">Loading your CV</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full">
        {hero}
        <div className="relative mx-auto -mt-14 max-w-2xl sm:-mt-16">
          <StatePanel
            role="alert"
            title="Couldn't load your new CV"
            action={<Link href="/dashboard/cv-builder" className={buttonStyles({ variant: "secondary", size: "lg" })}>Back to the builder</Link>}
          >
            {error}
          </StatePanel>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {hero}
      <div className="relative mx-auto -mt-14 grid max-w-6xl items-start gap-6 pb-24 sm:-mt-16 sm:pb-10 lg:grid-cols-3">
        <div className="space-y-6 lg:sticky lg:top-6 lg:order-2">
          <CVScoreCard />
          <div className={cn(cardCls, "p-5 sm:p-6")}>
            <p className="text-body-sm text-ink-muted">Your matches use this CV from now on.</p>
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem("cv_builder_draft");
                router.push("/dashboard/matches");
              }}
              className={cn(buttonStyles({ size: "lg", block: true }), "mt-4")}
            >
              See your matches
            </button>
            <Link href="/dashboard/profile" className="mt-3 block text-center text-body-sm font-medium text-brand-text underline-offset-4 hover:underline">
              Update job preferences
            </Link>
          </div>
        </div>

        <section aria-label="Your new CV" className={cn(cardCls, "overflow-hidden lg:order-1 lg:col-span-2")}>
          {cvText && (
            <div className="max-h-[75vh] overflow-y-auto bg-white px-6 py-8 sm:px-12 sm:py-12">
              <CVPreview cvText={cvText} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const cardCls = "rounded-[1.375rem] bg-surface-raised shadow-dossier ring-1 ring-line/60";

export default function CVBuilderPreviewPage() {
  return (
    <Suspense fallback={<div className="flex justify-center pt-24"><Spinner size="lg" label="Loading your CV" /></div>}>
      <PreviewContent />
    </Suspense>
  );
}
