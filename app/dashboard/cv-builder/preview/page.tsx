"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import CVScoreCard from "@/app/components/CVScoreCard";
import { showToast } from "@/app/components/Toast";
import { DownloadIcon, PageHero, Skeleton, Spinner, StatePanel, buttonStyles, heroControlStyles } from "@/app/components/ui";
import { cn } from "@/lib/cn";

const SECTION_HEADERS = new Set([
  "summary", "work experience", "experience", "education",
  "skills", "languages", "projects", "certifications",
]);

function CVPreview({ cvText }: { cvText: string }) {
  const lines = cvText.split("\n");

  let nameWritten = false;
  let contactWritten = false;

  return (
    <>
      {/* Carlito is metric-compatible with Calibri — used as fallback on non-Windows */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400;1,700&display=swap');`}</style>
    <div className="max-h-[75vh] overflow-y-auto px-6 py-8 text-[13px] leading-relaxed text-ink sm:px-12 sm:py-12" style={{ fontFamily: "Calibri, Carlito, Arial, sans-serif" }}>
      {lines.map((line, i) => {
        const trimmed = line.trim();

        if (!nameWritten && trimmed) {
          nameWritten = true;
          return (
            <div key={i} className="mb-1 text-center text-lg font-bold text-brand-text">
              {trimmed}
            </div>
          );
        }
        if (nameWritten && !contactWritten && trimmed) {
          contactWritten = true;
          return (
            <div key={i} className="mb-5 text-center text-xs text-ink-muted">
              {trimmed}
            </div>
          );
        }
        if (SECTION_HEADERS.has(trimmed.toLowerCase().replace(/:$/, ""))) {
          return (
            <div key={i} className="mb-1.5 mt-5 border-b border-brand/40 pb-0.5 text-xs font-bold uppercase tracking-wider text-brand-text">
              {trimmed.replace(/:$/, "")}
            </div>
          );
        }
        if (trimmed.startsWith("•")) {
          return <div key={i} className="pl-4 text-ink">{trimmed}</div>;
        }
        if (!trimmed) return <div key={i} className="h-2" />;
        return <div key={i} className="text-ink">{trimmed}</div>;
      })}
    </div>
    </>
  );
}

function PreviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cvId = searchParams.get("cv_id");

  const [cvText, setCvText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

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

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/cv/download-generated?cv_id=${cvId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? "Download failed", "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "My_CV.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast("Download failed. Try again.", "error");
    } finally {
      setDownloading(false);
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
          <button type="button" onClick={handleDownload} disabled={downloading} className={heroAction}>
            {downloading ? <Spinner size="sm" decorative /> : <DownloadIcon className="h-4 w-4" />}
            {downloading ? "Preparing…" : "Download .docx"}
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
          {cvText && <CVPreview cvText={cvText} />}
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
