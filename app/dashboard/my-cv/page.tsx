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
      <div className="text-[13px] leading-relaxed text-gray-800" style={{ fontFamily: "Calibri, Carlito, Arial, sans-serif" }}>
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="inline-block w-6 h-6 border-4 border-gray-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!cvText) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 text-sm mb-4">No CV found.</p>
          <Link href="/dashboard/onboarding" className="text-sm font-medium underline">Upload or build a CV</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-8">

          {/* Score card — first in DOM so it appears above CV on mobile */}
          <div className="lg:w-1/3 order-1 lg:order-2">
            <div className="lg:sticky lg:top-8">
              <CVScoreCard onImproved={(id) => { setCvId(id); loadCV(); }} />
            </div>
          </div>

          {/* CV preview — below score on mobile, left 2/3 on desktop */}
          <div className="lg:w-2/3 order-2 lg:order-1">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

              {/* Header bar with label and action buttons */}
              <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-gray-50">
                <span className="text-xs font-medium text-gray-500">CV Preview</span>
                <div className="flex gap-2">
                  <Link
                    href="/dashboard/onboarding"
                    className="text-xs font-medium border border-gray-200 bg-white text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    Replace CV
                  </Link>
                  {cvId && (
                    <button
                      onClick={handleDownload}
                      disabled={downloading}
                      className="text-xs font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
                    >
                      {downloading ? "Preparing…" : "Download .docx"}
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable CV content — white so text is always readable */}
              <div className="max-h-[75vh] overflow-y-auto bg-white p-8">
                <CVPreview cvText={cvText} />
              </div>

            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
