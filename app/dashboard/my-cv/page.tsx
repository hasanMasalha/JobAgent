"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CVScoreCard from "@/app/components/CVScoreCard";

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
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400;1,700&display=swap');`}</style>
      <div className="px-8 py-7 text-[13px] leading-relaxed text-gray-800" style={{ fontFamily: "Calibri, Carlito, Arial, sans-serif" }}>
        {lines.map((line, i) => {
          const trimmed = line.trim();
          if (!nameWritten && trimmed) {
            nameWritten = true;
            return <div key={i} className="text-base font-bold text-center text-gray-900 mb-1">{trimmed}</div>;
          }
          if (nameWritten && !contactWritten && trimmed) {
            contactWritten = true;
            return <div key={i} className="text-xs text-center text-gray-500 mb-4">{trimmed}</div>;
          }
          if (SECTION_HEADERS.has(trimmed.toLowerCase().replace(/:$/, ""))) {
            return <div key={i} className="mt-4 mb-1 font-bold text-xs text-gray-700 uppercase tracking-wider border-b border-gray-200 pb-0.5">{trimmed.replace(/:$/, "")}</div>;
          }
          if (trimmed.startsWith("•")) return <div key={i} className="pl-4 text-gray-700">{trimmed}</div>;
          if (!trimmed) return <div key={i} className="h-2" />;
          return <div key={i} className="text-gray-700">{trimmed}</div>;
        })}
      </div>
    </>
  );
}

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
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "My_CV.docx";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto mt-20 text-center">
        <div className="inline-block w-6 h-6 border-4 border-black dark:border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!cvText) {
    return (
      <div className="max-w-4xl mx-auto mt-20 text-center">
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">No CV found.</p>
        <Link href="/dashboard/onboarding" className="text-sm font-medium underline">Upload or build a CV</Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">My CV</h1>
        <div className="flex gap-2">
          <Link
            href="/dashboard/onboarding"
            className="text-xs font-medium border dark:border-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Replace CV
          </Link>
          {cvId && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="text-xs font-medium bg-black dark:bg-white dark:text-black text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              {downloading ? "Preparing…" : "Download .docx"}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* CV preview */}
        <div className="lg:col-span-3 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-900/50 border-b dark:border-gray-700 px-5 py-2">
            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">preview</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            <CVPreview cvText={cvText} />
          </div>
        </div>

        {/* Score card */}
        <div className="lg:col-span-2">
          <CVScoreCard onImproved={(id) => { setCvId(id); loadCV(); }} />
        </div>
      </div>
    </div>
  );
}
