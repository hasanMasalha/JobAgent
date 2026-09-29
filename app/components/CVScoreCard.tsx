"use client";

import { useState, useEffect } from "react";
import { Badge, Button, CheckIcon, CloseIcon, Notice, ScoreRing, Spinner, type BadgeTone } from "@/app/components/ui";
import { cn } from "@/lib/cn";

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

const GRADE_TONE: Record<string, BadgeTone> = { A: "success", B: "brand", C: "attention", D: "danger" };

const cardCls = "rounded-[1.375rem] bg-surface-raised p-5 shadow-dossier ring-1 ring-line/60 sm:p-7";
const groupLabel = "text-caption font-semibold uppercase tracking-wide text-ink-subtle";

function ImproveModal({ onClose }: { onClose: (cvId?: string) => void }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [cvId, setCvId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [downloading, setDownloading] = useState(false);

  // Escape closes, except while Claude is rewriting (closing then would hide the result).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && state !== "loading") onClose(cvId ?? undefined);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, cvId, onClose]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-gutter font-sans">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="improve-title"
        className="w-full max-w-md rounded-overlay bg-surface p-6 shadow-overlay"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="improve-title" className="font-serif text-title-serif text-ink">Improve with AI</h2>
          <Button variant="ghost" size="sm" onClick={() => onClose(cvId ?? undefined)} disabled={state === "loading"} aria-label="Close">
            <CloseIcon className="h-4 w-4" />
          </Button>
        </div>

        {state === "idle" && (
          <>
            <p className="mt-3 text-body text-ink-muted">
              Claude rewrites your CV with the suggested improvements: stronger verbs, measurable results and cleaner wording.
            </p>
            <Notice tone="attention" className="mt-4">The rewrite replaces your current CV.</Notice>
            <Button size="lg" block className="mt-6" onClick={handleImprove}>Rewrite my CV</Button>
          </>
        )}

        {state === "loading" && (
          <div className="py-10 text-center">
            <Spinner size="lg" label="Claude is improving your CV" />
            <p className="mt-3 text-body-sm text-ink-muted">Claude is improving your CV…</p>
          </div>
        )}

        {state === "done" && (
          <>
            <Notice tone="success" className="mt-4">Your CV has been improved and saved.</Notice>
            <div className="mt-6 space-y-2">
              <Button size="lg" block onClick={handleDownload} disabled={downloading} loading={downloading}>
                {downloading ? "Preparing…" : "Download improved CV (.docx)"}
              </Button>
              <Button size="lg" variant="secondary" block onClick={() => onClose(cvId ?? undefined)}>Close</Button>
            </div>
          </>
        )}

        {state === "error" && (
          <>
            <Notice tone="danger" className="mt-4">{errorMsg}</Notice>
            <Button size="lg" variant="secondary" block className="mt-6" onClick={() => setState("idle")}>Try again</Button>
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
      <div className={cn(cardCls, "flex flex-col items-center py-10 text-center")}>
        <Spinner size="lg" label="Scoring your CV" />
        <p className="mt-3 text-body-sm text-ink-muted">Scoring your CV…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cardCls}>
        <Notice tone="danger" title="Couldn't score your CV">{error}</Notice>
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

      <section aria-labelledby="cv-score-heading" className={cardCls}>
        <div className="flex items-center gap-5">
          <ScoreRing score={score.score} kind="cv" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="cv-score-heading" className="font-serif text-title-serif text-ink">CV score</h2>
              <Badge tone={GRADE_TONE[score.grade] ?? "neutral"}>Grade {score.grade}</Badge>
            </div>
            <p className="mt-1.5 text-body-sm text-ink-muted">{score.summary}</p>
          </div>
        </div>

        <div className="mt-6 space-y-6 border-t border-line pt-5">
          {score.strengths.length > 0 && (
            <div>
              <h3 className={groupLabel}>Strengths</h3>
              <ul className="mt-2.5 space-y-2">
                {score.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-body-sm text-ink">
                    <CheckIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sortedImprovements.length > 0 && (
            <div>
              <h3 className={groupLabel}>To improve</h3>
              <ul className="mt-2.5 space-y-3.5">
                {sortedImprovements.map((item, i) => (
                  <li key={i}>
                    <p className="text-body-sm font-semibold text-ink">
                      {item.priority === "high" && <Badge tone="attention" className="mr-2 align-[1px]">High priority</Badge>}
                      {item.issue}
                    </p>
                    <p className="mt-0.5 text-body-sm text-ink-muted">{item.fix}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button size="lg" block onClick={() => setShowModal(true)}>Improve with AI</Button>
        </div>
      </section>
    </>
  );
}
