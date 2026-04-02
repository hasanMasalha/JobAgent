"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { showToast } from "@/app/components/Toast";

type Stage = "loading" | "ready" | "submitting" | "error";

interface PrepareResult {
  application_id: string;
  cover_letter: string;
  tailored_cv: string;
  cv_changes: string[];
  job_title: string;
  company: string;
  job_url: string;
}

export default function ApplyPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("loading");
  const [data, setData] = useState<PrepareResult | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<{ status: string; message: string } | null>(null);
  const [downloadingCv, setDownloadingCv] = useState(false);

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

  async function handleDownloadCv() {
    if (!data) return;
    setDownloadingCv(true);
    try {
      const res = await fetch(`/api/apply/${data.application_id}/download-cv`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      a.download = match?.[1] ?? "CV_tailored.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Download failed", "error");
    } finally {
      setDownloadingCv(false);
    }
  }

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
      if (json.status === "applied") {
        showToast("Application submitted!", "success");
        setTimeout(() => router.push("/dashboard/applications"), 2000);
      } else if (json.status === "manual") {
        showToast("Cover letter saved — finish applying via the link below", "error");
        // Don't auto-redirect — let user see the manual apply button
      } else {
        showToast("Something went wrong — check applications", "error");
        setTimeout(() => router.push("/dashboard/applications"), 2000);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Submission failed";
      setError(msg);
      showToast(msg, "error");
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
    // Manual apply — stay on page and show clear CTA
    if (submitResult?.status === "manual") {
      return (
        <div className="max-w-2xl mx-auto mt-12">
          <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-6">
            <p className="text-lg font-semibold text-yellow-900 mb-1">You need to apply manually</p>
            <p className="text-sm text-yellow-800 mb-4">
              This job doesn&apos;t support automated apply. Your tailored cover letter has been
              saved — open the job and paste it when applying.
            </p>
            <a
              href={data?.cover_letter ? undefined : "#"}
              className="inline-block bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
              onClick={() => window.open(data!.job_url, "_blank")}
            >
              Open job &amp; apply →
            </a>
            <button
              onClick={() => router.push("/dashboard/applications")}
              className="ml-3 text-sm text-yellow-700 hover:underline"
            >
              View in applications
            </button>
          </div>
          {data?.cover_letter && (
            <div className="mt-5">
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Your saved cover letter</p>
              <textarea
                readOnly
                value={data.cover_letter}
                rows={10}
                className="w-full border rounded-xl p-4 text-sm text-gray-700 bg-gray-50 resize-none"
              />
              <div className="mt-2 flex gap-4">
                <button
                  onClick={() => navigator.clipboard.writeText(coverLetter)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Copy to clipboard
                </button>
                <button
                  onClick={handleDownloadCv}
                  disabled={downloadingCv}
                  className="text-xs text-emerald-600 hover:underline disabled:opacity-50"
                >
                  {downloadingCv ? "Generating PDF…" : "Download tailored CV"}
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        {submitResult ? (
          <>
            <p className="text-lg font-semibold text-gray-900">Application submitted!</p>
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
