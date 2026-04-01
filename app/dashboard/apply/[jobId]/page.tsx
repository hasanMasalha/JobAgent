"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Stage = "loading" | "ready" | "submitting" | "error";

interface PrepareResult {
  application_id: string;
  cover_letter: string;
  cv_changes: string[];
  job_title: string;
  company: string;
}

export default function ApplyPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("loading");
  const [data, setData] = useState<PrepareResult | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/apply/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId }),
      signal: AbortSignal.timeout(120_000),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to prepare application");
        return json as PrepareResult;
      })
      .then((result) => {
        setData(result);
        setCoverLetter(result.cover_letter);
        setStage("ready");
      })
      .catch((err) => {
        setError(err.message);
        setStage("error");
      });
  }, [jobId]);

  async function handleConfirm() {
    if (!data) return;
    setStage("submitting");
    try {
      const res = await fetch("/api/apply/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: data.application_id, cover_letter: coverLetter }),
        signal: AbortSignal.timeout(120_000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Submission failed");
      setSubmitResult(json);
      // Brief pause so user sees the result, then redirect
      setTimeout(() => router.push("/dashboard/applications"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setStage("error");
    }
  }

  /* ── Loading ── */
  if (stage === "loading") {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <div className="inline-block w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-600 font-medium">Preparing your application…</p>
        <p className="text-sm text-gray-400 mt-1">Claude is tailoring your CV — this takes about 10–15 seconds</p>
      </div>
    );
  }

  /* ── Error ── */
  if (stage === "error") {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-700">
          {error}
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="mt-4 text-sm text-gray-500 hover:underline"
        >
          ← Back to dashboard
        </button>
      </div>
    );
  }

  /* ── Submitting / Done ── */
  if (stage === "submitting") {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        {submitResult ? (
          <>
            <p className="text-lg font-semibold text-gray-900">
              {submitResult.status === "applied" ? "Application submitted!" : "Application saved"}
            </p>
            <p className="text-sm text-gray-500 mt-1">{submitResult.message}</p>
            <p className="text-xs text-gray-400 mt-3">Redirecting…</p>
          </>
        ) : (
          <>
            <div className="inline-block w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-600 font-medium">Submitting your application…</p>
          </>
        )}
      </div>
    );
  }

  /* ── Ready ── */
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{data!.job_title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{data!.company}</p>
      </div>

      {/* CV Changes */}
      {data!.cv_changes.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-emerald-800 mb-2">Changes Claude made to your CV</p>
          <ul className="space-y-1">
            {data!.cv_changes.map((change, i) => (
              <li key={i} className="text-sm text-emerald-700 flex gap-2">
                <span className="shrink-0">✓</span>
                {change}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cover Letter */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Cover Letter <span className="font-normal text-gray-400">(editable)</span>
        </label>
        <textarea
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          rows={12}
          className="w-full border border-gray-300 rounded-xl p-4 text-sm text-gray-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pb-8">
        <button
          onClick={() => router.push("/dashboard")}
          className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
        >
          Confirm &amp; Apply
        </button>
      </div>
    </div>
  );
}
