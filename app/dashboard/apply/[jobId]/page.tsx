"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { showToast } from "@/app/components/Toast";

const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? ""

function _detectExtension(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!EXTENSION_ID || typeof chrome === "undefined" || !chrome?.runtime?.sendMessage) {
      resolve(false)
      return
    }
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, { type: "PING" }, () => {
        resolve(!chrome.runtime.lastError)
      })
    } catch {
      resolve(false)
    }
  })
}

type Stage = "loading" | "ready" | "submitting" | "error" | "no_extension" | "extension_launched" | "applying_background";

interface PrepareResult {
  application_id: string;
  cover_letter: string;
  tailored_cv: string;
  cv_changes: string[];
  job_title: string;
  company: string;
  job_url: string;
  match_score: number | null;
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
  const [bgStatus, setBgStatus] = useState<string | null>(null);

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

    // Save cover letter edits first
    await fetch("/api/apply/submit-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_id: data.application_id, cover_letter: coverLetter }),
    }).catch(() => null);

    // For LinkedIn jobs use the extension flow — always proceed regardless of
    // detectExtension() result (service worker can be sleeping and fail the ping)
    const isLinkedIn = data.job_url.includes("linkedin.com");
    if (isLinkedIn) {
      // Mark as pending_extension — await the full DB write before opening the tab
      const markRes = await fetch("/api/apply/mark-pending-extension", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: data.application_id }),
      });
      const markData = markRes.ok ? await markRes.json() : {};
      console.log("JobAgent: marked as pending:", markRes.status, markData);

      // Open LinkedIn tab silently in the background via the extension.
      // Falls back to a visible tab if the extension is unavailable.
      console.log("JobAgent: extension ID:", EXTENSION_ID)
      console.log("JobAgent: chrome.runtime available:", !!(window as Window & typeof globalThis & { chrome?: { runtime?: unknown } }).chrome?.runtime)
      console.log("JobAgent: job URL:", data.job_url)

      const openedInBackground = await new Promise<boolean>((resolve) => {
        if (!EXTENSION_ID || typeof chrome === "undefined" || !chrome?.runtime?.sendMessage) {
          resolve(false)
          return
        }
        try {
          chrome.runtime.sendMessage(
            EXTENSION_ID,
            { type: "OPEN_APPLY_TAB", jobUrl: data.job_url, applicationId: data.application_id },
            (response) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const err = (chrome.runtime as any).lastError
              if (err) {
                console.error("JobAgent: OPEN_APPLY_TAB failed:", err.message)
                resolve(false)
              } else {
                console.log("JobAgent: background tab opened:", response)
                resolve(response?.success === true)
              }
            }
          )
        } catch (e) {
          console.error("JobAgent: sendMessage threw:", e)
          resolve(false)
        }
      })

      if (!openedInBackground) {
        window.open(data.job_url, "_blank")
        setStage("extension_launched")
        return
      }

      // Poll application status every 3 s until the extension finishes
      setStage("applying_background")
      setBgStatus("pending_extension")
      const applicationId = data.application_id
      const poll = setInterval(async () => {
        try {
          const res = await fetch(`/api/applications/${applicationId}/status`)
          if (!res.ok) return
          const { status } = await res.json()
          setBgStatus(status)
          if (status === "applied") {
            clearInterval(poll)
            showToast("Application submitted!", "success")
            setTimeout(() => router.push("/dashboard/applications"), 2500)
          } else if (status === "manual") {
            clearInterval(poll)
          }
        } catch { /* network blip — keep polling */ }
      }, 3000)
      // Stop polling after 5 minutes maximum
      setTimeout(() => clearInterval(poll), 5 * 60 * 1000)
      return;
    }

    // Non-LinkedIn: server-side Playwright flow (keep as fallback)
    setStage("submitting");
    try {
      const res = await fetch("/api/apply/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: data.application_id, cover_letter: coverLetter }),
        signal: AbortSignal.timeout(310_000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Submission failed");
      setSubmitResult(json);
      if (json.status === "applied") {
        showToast("Application submitted!", "success");
        setTimeout(() => router.push("/dashboard/applications"), 2000);
      } else if (json.status === "manual") {
        showToast("Cover letter saved — finish applying via the link below", "error");
      } else if (json.status === "timeout") {
        // amber message shown below
      } else {
        setError(json.message ?? "Something went wrong");
        setStage("error");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Submission failed";
      setError(msg);
      showToast(msg, "error");
      setStage("error");
    }
  }

  /* ── Extension not installed ── */
  if (stage === "no_extension") {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-4">🔌</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Install JobAgent Extension
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
            To apply automatically on LinkedIn, install the free JobAgent Chrome Extension.
          </p>
          {process.env.NEXT_PUBLIC_EXTENSION_ID ? (
            <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
              Extension is loaded but not detected. Go to <strong>chrome://extensions</strong>, find <strong>JobAgent DEV</strong> and click the reload icon, then come back.
            </p>
          ) : (
            <a
              href="https://chromewebstore.google.com/detail/jobagent-%E2%80%94-ai-job-assista/cjcfjidmlmclbemjoobdipjlcdbkldda"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-[#1a2e5e] text-white text-sm font-semibold px-6 py-3 rounded-lg mb-3"
            >
              Install Extension (Free)
            </a>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            Takes 30 seconds · Works on Chrome &amp; Edge
          </p>
          <button
            onClick={() => setStage("submitting")}
            className="block w-full text-sm text-gray-500 dark:text-gray-400 underline"
          >
            Apply manually instead (server-side)
          </button>
        </div>
      </div>
    );
  }

  /* ── Applying silently in background ── */
  if (stage === "applying_background") {
    const done = bgStatus === "applied"
    const manual = bgStatus === "manual"
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        {done ? (
          <>
            <div className="text-4xl mb-4">✅</div>
            <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Application submitted!</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Redirecting to your applications…</p>
          </>
        ) : manual ? (
          <>
            <div className="text-4xl mb-4">🔗</div>
            <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Manual apply needed</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              This job doesn&apos;t support automated apply. Your tailored cover letter is saved.
            </p>
            <a
              href={data?.job_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-[#1a2e5e] text-white text-sm font-semibold px-5 py-2.5 rounded-lg"
            >
              Open job &amp; apply →
            </a>
          </>
        ) : (
          <>
            <div className="inline-block w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              ⚡ Applying in background…
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
              The extension is filling the Easy Apply form silently.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              You&apos;ll get a Chrome notification when done. This page polls automatically.
            </p>
          </>
        )}
        <button
          onClick={() => router.push("/dashboard/applications")}
          className="mt-6 text-sm text-[#1a2e5e] dark:text-blue-400 underline"
        >
          View applications
        </button>
      </div>
    )
  }

  /* ── Extension launched ── */
  if (stage === "extension_launched") {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <div className="text-4xl mb-4">⚡</div>
        <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Applying via extension…
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          The LinkedIn tab opened. The extension will fill and submit the Easy Apply form automatically.
        </p>
        {process.env.NEXT_PUBLIC_EXTENSION_ID && (
          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2 mb-6">
            If the form didn&apos;t fill automatically, reload the extension at{" "}
            <strong>chrome://extensions</strong> and try again.
          </p>
        )}
        <button
          onClick={() => router.push("/dashboard/applications")}
          className="text-sm text-[#1a2e5e] dark:text-blue-400 underline"
        >
          View applications
        </button>
      </div>
    );
  }

  /* ── Loading ── */
  if (stage === "loading") {
    return (
      <div className="max-w-2xl mx-auto mt-20 text-center">
        <div className="inline-block w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-600 dark:text-gray-300 font-medium">Preparing your application…</p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Claude is tailoring your CV — this takes about 10–15 seconds</p>
      </div>
    );
  }

  /* ── Error ── */
  if (stage === "error") {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-5 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="mt-4 text-sm text-gray-500 dark:text-gray-400 hover:underline"
        >
          ← Back to dashboard
        </button>
      </div>
    );
  }

  /* ── Submitting / Done ── */
  if (stage === "submitting") {
    // Timeout — show amber confirmation prompt
    if (submitResult?.status === "timeout") {
      return (
        <div className="max-w-2xl mx-auto mt-12">
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-6">
            <p className="text-lg font-semibold text-amber-900 mb-1">
              Application may have been submitted successfully
            </p>
            <p className="text-sm text-amber-800 mb-4">
              The submission took longer than expected. Please check your LinkedIn Sent
              Applications to confirm, then update the status here.
            </p>
            <a
              href="https://www.linkedin.com/my-items/saved-jobs/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
            >
              Check LinkedIn Sent Applications →
            </a>
            <button
              onClick={() => router.push("/dashboard/applications")}
              className="ml-3 text-sm text-amber-700 hover:underline"
            >
              View in applications
            </button>
          </div>
        </div>
      );
    }

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
              href={data?.job_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
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
          {coverLetter && (
            <div className="mt-5">
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Your saved cover letter</p>
              <textarea
                readOnly
                value={coverLetter}
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
                  {downloadingCv ? "Generating…" : "Download CV (.docx)"}
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
            <p className="text-lg font-semibold text-gray-900 dark:text-white">Application submitted!</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{submitResult.message}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">Redirecting…</p>
          </>
        ) : (
          <>
            <div className="inline-block w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-600 dark:text-gray-300 font-medium">Submitting your application…</p>
          </>
        )}
      </div>
    );
  }

  /* ── Ready ── */
  const lowMatch = data?.match_score !== null && data?.match_score !== undefined && data.match_score < 0.45;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{data!.job_title}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{data!.company}</p>
      </div>

      {/* Low-match warning */}
      {lowMatch && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <span className="font-semibold">Warning:</span> This role may not match your background
          well. The CV tailoring will be limited to avoid misrepresentation.
        </div>
      )}

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
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Cover Letter <span className="font-normal text-gray-400 dark:text-gray-500">(editable)</span>
        </label>
        <textarea
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          rows={12}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl p-4 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pb-8">
        <button
          onClick={() => router.push("/dashboard")}
          className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
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
