"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

const SECTION_HEADERS = new Set([
  "summary", "work experience", "experience", "education",
  "skills", "languages", "projects", "certifications",
]);

function CVPreview({ cvText }: { cvText: string }) {
  const lines = cvText.split("\n");
  let nameWritten = false;
  let contactWritten = false;

  return (
    <div className="px-8 py-7 font-mono text-[13px] leading-relaxed text-gray-800 whitespace-pre-wrap max-h-[70vh] overflow-y-auto">
      {lines.map((line, i) => {
        const trimmed = line.trim();

        if (!nameWritten && trimmed) {
          nameWritten = true;
          return (
            <div key={i} className="text-base font-bold text-center text-gray-900 mb-1">
              {trimmed}
            </div>
          );
        }
        if (nameWritten && !contactWritten && trimmed) {
          contactWritten = true;
          return (
            <div key={i} className="text-xs text-center text-gray-500 mb-4">
              {trimmed}
            </div>
          );
        }
        if (SECTION_HEADERS.has(trimmed.toLowerCase().replace(/:$/, ""))) {
          return (
            <div key={i} className="mt-4 mb-1 font-bold text-xs text-gray-700 uppercase tracking-wider border-b border-gray-200 pb-0.5">
              {trimmed.replace(/:$/, "")}
            </div>
          );
        }
        if (trimmed.startsWith("•")) {
          return <div key={i} className="pl-4 text-gray-700">{trimmed}</div>;
        }
        if (!trimmed) return <div key={i} className="h-2" />;
        return <div key={i} className="text-gray-700">{trimmed}</div>;
      })}
    </div>
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
  const [toastMsg, setToastMsg] = useState<string | null>(null);

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

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/cv/download-generated?cv_id=${cvId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? "Download failed");
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
      showToast("Download failed. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <div className="inline-block w-6 h-6 border-4 border-black border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm text-gray-500">Loading your CV…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <p className="text-red-600 text-sm mb-4">{error}</p>
        <Link href="/dashboard/cv-builder" className="text-sm font-medium underline">
          ← Back to builder
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toastMsg}
        </div>
      )}

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Your CV is ready</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Review it below, then download or go to your dashboard.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/dashboard/cv-builder"
            className="text-xs font-medium border px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            ← Regenerate
          </Link>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="text-xs font-medium bg-black text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {downloading ? "Preparing…" : "Download .docx"}
          </button>
        </div>
      </div>

      <div className="bg-white border rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="bg-gray-50 border-b px-5 py-2 flex items-center justify-between">
          <span className="text-xs text-gray-400 font-mono">preview</span>
        </div>
        {cvText && <CVPreview cvText={cvText} />}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            sessionStorage.removeItem("cv_builder_draft");
            router.push("/dashboard");
          }}
          className="text-sm font-medium bg-black text-white px-5 py-2 rounded-lg hover:bg-gray-800 transition-colors"
        >
          Go to dashboard →
        </button>
        <Link
          href="/dashboard/onboarding"
          className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
        >
          Update job preferences
        </Link>
      </div>
    </div>
  );
}

export default function CVBuilderPreviewPage() {
  return (
    <Suspense fallback={
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <div className="inline-block w-6 h-6 border-4 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <PreviewContent />
    </Suspense>
  );
}
