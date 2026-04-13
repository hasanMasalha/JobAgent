"use client";

import { useState, useEffect } from "react";

interface Improvement {
  issue: string;
  fix: string;
  priority: "high" | "medium";
}

interface CVScore {
  score: number;
  grade: "A" | "B" | "C" | "D";
  summary: string;
  strengths: string[];
  improvements: Improvement[];
}

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 80 ? "#16a34a" : score >= 60 ? "#d97706" : "#dc2626";
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="96" height="96" className="-rotate-90">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <span
        className="absolute text-2xl font-bold"
        style={{ color }}
      >
        {score}
      </span>
    </div>
  );
}

function GradeBadge({ grade }: { grade: string }) {
  const styles: Record<string, string> = {
    A: "bg-green-100 text-green-800",
    B: "bg-amber-100 text-amber-800",
    C: "bg-orange-100 text-orange-800",
    D: "bg-red-100 text-red-800",
  };
  return (
    <span className={`inline-block text-sm font-bold px-2.5 py-0.5 rounded-full ${styles[grade] ?? "bg-gray-100 text-gray-700"}`}>
      {grade}
    </span>
  );
}

function ImproveModal({ onClose }: { onClose: (cvId?: string) => void }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [cvId, setCvId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [downloading, setDownloading] = useState(false);

  async function handleImprove() {
    setState("loading");
    try {
      const res = await fetch("/api/cv/improve", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to improve CV");
      setCvId(data.cv_id);
      setState("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  async function handleDownload() {
    if (!cvId) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/cv/download-generated?cv_id=${cvId}`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Improved_CV.docx";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Improve with AI</h2>
          <button onClick={() => onClose(cvId ?? undefined)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {state === "idle" && (
          <>
            <p className="text-sm text-gray-600 mb-5">
              Claude will rewrite your CV applying all the suggested improvements — stronger verbs, quantified achievements, cleaner language. Your current CV will be replaced with the improved version.
            </p>
            <button
              onClick={handleImprove}
              className="w-full bg-black text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              Rewrite my CV
            </button>
          </>
        )}

        {state === "loading" && (
          <div className="text-center py-8">
            <div className="inline-block w-6 h-6 border-4 border-black border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-500">Claude is improving your CV…</p>
          </div>
        )}

        {state === "done" && (
          <>
            <div className="flex items-center gap-2 text-green-700 mb-4">
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm font-medium">Your CV has been improved and saved.</p>
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full bg-black text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors mb-2"
            >
              {downloading ? "Preparing…" : "Download improved CV (.docx)"}
            </button>
            <button
              onClick={() => onClose(cvId ?? undefined)}
              className="w-full border py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          </>
        )}

        {state === "error" && (
          <>
            <p className="text-sm text-red-600 mb-4">{errorMsg}</p>
            <button
              onClick={() => setState("idle")}
              className="w-full border py-2 rounded-lg text-sm hover:bg-gray-50"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface CVScoreCardProps {
  /** If omitted the card fetches the score itself on mount */
  initialScore?: CVScore;
  /** Called after "Improve with AI" completes so parent can refresh the CV */
  onImproved?: (cvId: string) => void;
}

export default function CVScoreCard({ initialScore, onImproved }: CVScoreCardProps) {
  const [score, setScore] = useState<CVScore | null>(initialScore ?? null);
  const [loading, setLoading] = useState(!initialScore);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);

  // Fetch score on mount if not provided
  useEffect(() => {
    if (initialScore) return;
    fetch("/api/cv/score", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setScore(d);
      })
      .catch((err) => setError(err.message ?? "Failed to score CV"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleModalClose(cvId?: string) {
    setShowModal(false);
    if (cvId && onImproved) onImproved(cvId);
    // Re-fetch score after improvement
    if (cvId) {
      setLoading(true);
      setScore(null);
      fetch("/api/cv/score", { method: "POST" })
        .then((r) => r.json())
        .then((d) => { if (!d.error) setScore(d); })
        .finally(() => setLoading(false));
    }
  }

  if (loading) {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center">
        <div className="inline-block w-5 h-5 border-4 border-black border-t-transparent rounded-full animate-spin mb-2" />
        <p className="text-sm text-gray-500">Scoring your CV…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border rounded-2xl p-6 text-center">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (!score) return null;

  const highPriority = score.improvements.filter((i) => i.priority === "high");
  const mediumPriority = score.improvements.filter((i) => i.priority === "medium");
  const sortedImprovements = [...highPriority, ...mediumPriority];

  return (
    <>
      {showModal && <ImproveModal onClose={handleModalClose} />}

      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
        {/* Header row */}
        <div className="px-6 pt-6 pb-4 flex items-center gap-5 border-b">
          <ScoreRing score={score.score} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-gray-900">CV Score</span>
              <GradeBadge grade={score.grade} />
            </div>
            <p className="text-sm text-gray-600 leading-snug">{score.summary}</p>
          </div>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Strengths */}
          {score.strengths.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Strengths</p>
              <ul className="space-y-1.5">
                {score.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Improvements */}
          {sortedImprovements.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Improvements</p>
              <ul className="space-y-3">
                {sortedImprovements.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className={`mt-0.5 shrink-0 inline-block w-2 h-2 rounded-full ${item.priority === "high" ? "bg-red-400" : "bg-amber-400"}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{item.issue}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{item.fix}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={() => setShowModal(true)}
            className="w-full bg-black text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Improve with AI
          </button>
        </div>
      </div>
    </>
  );
}
