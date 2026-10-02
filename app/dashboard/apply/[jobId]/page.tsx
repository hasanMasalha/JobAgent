"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { showToast } from "@/app/components/Toast";
import {
  Button,
  DownloadIcon,
  Notice,
  PageHero,
  Skeleton,
  Spinner,
  StatePanel,
  Textarea,
  buttonStyles,
} from "@/app/components/ui";
import { cn } from "@/lib/cn";
import { isVersionAtLeast } from "@/lib/extension-version";

const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? "";

type Stage = "loading" | "ready" | "submitting" | "error" | "extension_required" | "extension_launched" | "applying_background";

type ATSPlatform = "greenhouse" | "lever" | "workable" | "ashby";

function detectATS(url: string): ATSPlatform | null {
  const u = (url ?? "").toLowerCase();
  // gh_jid means Greenhouse is embedded on the company's own domain instead
  // of greenhouse.io directly.
  if (u.includes("greenhouse.io") || u.includes("gh_jid=")) return "greenhouse";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("workable.com")) return "workable";
  if (u.includes("ashbyhq.com")) return "ashby";
  return null;
}

const ATS_NAMES: Record<ATSPlatform, string> = { greenhouse: "Greenhouse", lever: "Lever", workable: "Workable", ashby: "Ashby" };

// Extension outcomes that mean "the user has to finish this one" — see
// lib/application-status.ts (legacy failed / needs_security_code included).
const MANUAL_STATUSES = new Set(["manual", "failed", "needs_manual", "needs_security_code"]);

interface PrepareResult {
  application_id: string;
  cover_letter: string;
  tailored_cv: string;
  cv_changes: string[];
  job_title: string;
  company: string;
  job_url: string;
  match_score: number | null;
  /** LinkedIn Easy Apply job: nothing was tailored, see /api/apply/prepare. */
  linkedin?: boolean;
}

const EXTENSION_STORE_URL = "https://chromewebstore.google.com/detail/jobagent-%E2%80%94-ai-job-assista/cjcfjidmlmclbemjoobdipjlcdbkldda";

// The installed extension's version: null if it doesn't answer, "0" if it
// answers without one (versions before 1.5.0 didn't report it). Asked twice,
// because the first message can find its service worker still waking up.
function extensionVersion(): Promise<string | null> {
  const ask = () =>
    new Promise<string | null>((resolve) => {
      if (typeof chrome === "undefined" || !chrome?.runtime?.sendMessage) return resolve(null);
      const timer = setTimeout(() => resolve(null), 1500);
      try {
        chrome.runtime.sendMessage(EXTENSION_ID, { type: "PING" }, (response) => {
          clearTimeout(timer);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((chrome.runtime as any).lastError) return resolve(null);
          resolve(typeof response?.version === "string" ? response.version : "0");
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
  return ask().then((v) => v ?? ask());
}

// What /api/profile returns for the answers the extension may type into
// Easy Apply. The last six only count once the user has confirmed them.
interface ApplicationAnswers {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  city: string | null;
  expected_salary: string | null;
  notice_period: string | null;
  years_of_experience: string | null;
  highest_education: string | null;
  work_authorized: boolean | null;
  requires_sponsorship: boolean | null;
  willing_to_relocate: boolean | null;
  application_details_confirmed: boolean;
}

const yesNo = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "");

const cardCls = "rounded-[1.375rem] bg-surface-raised shadow-dossier ring-1 ring-line/60";
const groupLabel = "text-caption font-semibold uppercase tracking-wide text-ink-subtle";

// What "Confirm & apply" will do for this job — shown before the user clicks.
function submitPlan(url: string): { title: string; detail: string } {
  const ats = detectATS(url);
  if (ats) return { title: `Sends your application straight to ${ATS_NAMES[ats]}`, detail: "With the CV and cover letter below. You'll see the result here in about a minute." };
  if (url.includes("linkedin.com")) return { title: "Opens the job on LinkedIn", detail: "The JobAgent extension fills in Easy Apply with your answers and submits it. This uses one auto-apply, returned if it can't submit. You need the extension installed and to be signed in to LinkedIn." };
  return { title: "Tries to apply on the job's site", detail: "If the site sends us elsewhere or can't be completed automatically, you'll get a link to finish yourself, with your cover letter ready to paste." };
}

// The tailored CV as plain text, laid out like My CV's preview.
const SECTION_HEADERS = new Set(["summary", "work experience", "experience", "education", "skills", "languages", "projects", "certifications"]);
function CVText({ text }: { text: string }) {
  let seenName = false;
  let seenContact = false;
  return (
    <div className="text-[13px] leading-relaxed text-ink">
      {text.split("\n").map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-2" />;
        if (!seenName) { seenName = true; return <div key={i} className="mb-1 text-center text-base font-bold text-brand-text">{t}</div>; }
        if (!seenContact) { seenContact = true; return <div key={i} className="mb-4 text-center text-xs text-ink-muted">{t}</div>; }
        if (SECTION_HEADERS.has(t.toLowerCase().replace(/:$/, ""))) {
          return <div key={i} className="mb-1.5 mt-4 border-b border-brand/40 pb-0.5 text-xs font-bold uppercase tracking-wider text-brand-text">{t.replace(/:$/, "")}</div>;
        }
        return <div key={i} className={t.startsWith("•") ? "pl-4" : undefined}>{t}</div>;
      })}
    </div>
  );
}

export default function ApplyPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDownloadMode = searchParams.get("mode") === "download";

  const [stage, setStage] = useState<Stage>("loading");
  const [data, setData] = useState<PrepareResult | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<{ status: string; message: string } | null>(null);
  const [downloadingCv, setDownloadingCv] = useState(false);
  const [bgStatus, setBgStatus] = useState<string | null>(null);
  const [bgTimedOut, setBgTimedOut] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const [limitKind, setLimitKind] = useState<"tailoring" | "autoApply">("tailoring");
  const [extensionProblem, setExtensionProblem] = useState<"missing" | "outdated">("missing");
  const [answers, setAnswers] = useState<ApplicationAnswers | null>(null);
  const [approving, setApproving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showCv, setShowCv] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  useEffect(() => {
    setStage("loading");
    fetch("/api/apply/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, mode: isDownloadMode ? "download" : undefined }),
      signal: AbortSignal.timeout(120_000),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          if (json.error === "limit_reached") {
            const url = typeof json.upgrade_url === "string" && json.upgrade_url.startsWith("/") ? json.upgrade_url : "/pricing";
            setUpgradeUrl(url);
          }
          throw new Error(json.message ?? json.error ?? "Failed to prepare application");
        }
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
  }, [jobId, isDownloadMode]);

  // LinkedIn review: the answers the extension is allowed to use.
  const isLinkedInReview = !!data?.linkedin;
  useEffect(() => {
    if (!isLinkedInReview) return;
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((p) => setAnswers(p as ApplicationAnswers))
      .catch(() => showToast("Couldn't load your answers from Profile.", "error"));
  }, [isLinkedInReview]);

  async function approveAnswers() {
    setApproving(true);
    const ok = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm_application_details: true }),
    }).then((r) => r.ok).catch(() => false);
    setApproving(false);
    if (!ok) return showToast("Couldn't save that. Please try again.", "error");
    setAnswers((a) => (a ? { ...a, application_details_confirmed: true } : a));
  }

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
    // Guards a double click: the button is disabled from here on, before the
    // first await, so a second click can't start a second submission.
    if (!data || confirming) return;
    setConfirming(true);

    // Save cover letter edits first. If that fails, stop — submitting would
    // send (or hand the extension) the unedited letter.
    const saved = data.linkedin || await fetch("/api/apply/submit-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_id: data.application_id, cover_letter: coverLetter }),
    }).then((r) => r.ok).catch(() => false);
    if (!saved) {
      showToast("Couldn't save your cover letter edits, so nothing was submitted. Please try again.", "error");
      setConfirming(false);
      return;
    }

    // ATS API submission — Greenhouse, Lever, Workable, Ashby
    const atsPlatform = detectATS(data.job_url);
    if (atsPlatform) {
      setStage("submitting");
      try {
        const res = await fetch("/api/apply/ats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, applicationId: data.application_id, coverLetter }),
        });
        const json = await res.json() as {
          success?: boolean; error?: string; status?: string; recaptcha?: boolean; manual_url?: string; message?: string;
        };
        if (json.recaptcha) {
          setManualUrl(json.manual_url ?? data.job_url);
          setError("This job's form is protected by reCAPTCHA, so it can't be submitted automatically. Open the job to apply yourself.");
          setStage("error");
          return;
        }
        if (json.status === "applying") {
          setSubmitResult({
            status: "applying",
            message: `We're filling in the ${ATS_NAMES[atsPlatform]} form now. Check Applications in a minute to see whether it went through.`,
          });
          setTimeout(() => router.push("/dashboard/applications"), 3500);
          return;
        }
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? "ATS submission failed");
        }
        setSubmitResult({ status: "applied", message: `Submitted directly to ${ATS_NAMES[atsPlatform]}.` });
        showToast("Application submitted!", "success");
        setTimeout(() => router.push("/dashboard/applications"), 2000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "ATS submission failed";
        setError(msg);
        setStage("error");
      }
      return;
    }

    // For LinkedIn jobs use the extension flow — always proceed regardless of
    // whether the extension answers a ping (its service worker can be asleep).
    if (data.job_url.includes("linkedin.com")) {
      // Mark as pending_extension — await the full DB write before opening the
      // tab. If that fails, stop: the extension would open LinkedIn and find
      // nothing pending to apply to.
      //
      // Before that, the extension has to be installed and new enough: older
      // versions typed answers nobody gave, and the server refuses them. This
      // check runs first so nothing is marked or charged for an apply that
      // can't happen. (Without NEXT_PUBLIC_EXTENSION_ID the page can't ask;
      // the server-side refusal in /api/apply/check-pending still applies.)
      if (EXTENSION_ID) {
        const version = await extensionVersion();
        if (!isVersionAtLeast(version)) {
          setExtensionProblem(version ? "outdated" : "missing");
          setStage("extension_required");
          return;
        }
      }

      const markRes = await fetch("/api/apply/mark-pending-extension", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: data.application_id }),
      }).catch(() => null);
      if (markRes?.status === 403) {
        const json = await markRes.json().catch(() => ({}));
        if (json.error === "limit_reached") {
          setUpgradeUrl(typeof json.upgrade_url === "string" && json.upgrade_url.startsWith("/") ? json.upgrade_url : "/pricing");
          setLimitKind("autoApply");
          setError(json.message ?? "You've reached your monthly auto-apply limit.");
          setStage("error");
          return;
        }
      }
      const marked = !!markRes?.ok;
      if (!marked) {
        showToast("Couldn't start the LinkedIn application, so nothing was opened. Please try again.", "error");
        setConfirming(false);
        return;
      }

      // Open LinkedIn via the extension; fall back to a plain tab.
      const openedByExtension = await new Promise<boolean>((resolve) => {
        if (!EXTENSION_ID || typeof chrome === "undefined" || !chrome?.runtime?.sendMessage) {
          resolve(false);
          return;
        }
        try {
          chrome.runtime.sendMessage(
            EXTENSION_ID,
            { type: "OPEN_APPLY_TAB", jobUrl: data.job_url, applicationId: data.application_id },
            (response) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const err = (chrome.runtime as any).lastError;
              resolve(!err && response?.success === true);
            }
          );
        } catch {
          resolve(false);
        }
      });

      if (!openedByExtension) {
        window.open(data.job_url, "_blank");
        setStage("extension_launched");
        return;
      }

      // Poll application status every 3 s until the extension finishes
      setStage("applying_background");
      setBgStatus("pending_extension");
      const applicationId = data.application_id;
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/applications/${applicationId}/status`);
          if (!res.ok) return;
          const { status } = await res.json();
          setBgStatus(status);
          if (status === "applied") {
            if (pollRef.current) clearInterval(pollRef.current);
            showToast("Application submitted!", "success");
            setTimeout(() => router.push("/dashboard/applications"), 2500);
          } else if (MANUAL_STATUSES.has(status)) {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch { /* network blip — keep polling */ }
      }, 3000);
      // Stop polling after 5 minutes and say so, rather than spinning forever.
      setTimeout(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        setBgTimedOut(true);
      }, 5 * 60 * 1000);
      return;
    }

    // Anything else: the AI service tries the site (Indeed Apply) and falls
    // back to a manual link.
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
      } else if (json.status !== "manual" && json.status !== "timeout") {
        setError(json.message ?? "Something went wrong");
        setStage("error");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Submission failed";
      setError(msg);
      setStage("error");
    }
  }

  const title = data ? `${data.job_title}` : "Tailor CV & apply";
  const subtitle = data ? data.company : undefined;
  const back = (
    <Link href="/dashboard/matches" className="inline-flex items-center gap-1 rounded-sm text-body-sm text-on-hero-muted hover:text-on-hero focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
      <span aria-hidden="true">←</span> Matches
    </Link>
  );
  const shell = (body: React.ReactNode, wide = false) => (
    <div className="w-full">
      <PageHero tabs={back} title={title} subtitle={subtitle} />
      <div className={cn("relative mx-auto -mt-14 pb-24 sm:-mt-16 sm:pb-10", wide ? "max-w-6xl" : "max-w-2xl")}>{body}</div>
    </div>
  );
  const toApplications = (
    <Button variant="secondary" size="lg" onClick={() => router.push("/dashboard/applications")}>View applications</Button>
  );
  const openJob = (label = "Open the job") => (
    <a href={data?.job_url ?? manualUrl ?? "#"} target="_blank" rel="noopener noreferrer" className={buttonStyles({ variant: "attention", size: "lg" })}>
      {label} <span aria-hidden="true">↗</span>
    </a>
  );
  const copyLetter = () =>
    navigator.clipboard.writeText(coverLetter).then(() => showToast("Copied", "success"), () => showToast("Couldn't copy", "error"));
  const coverLetterCopy = coverLetter && (
    <div className={cn(cardCls, "mt-4 p-5 sm:p-6")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={groupLabel}>Your cover letter</h2>
        <Button size="sm" variant="ghost" onClick={copyLetter}>
          Copy
        </Button>
      </div>
      <Textarea readOnly value={coverLetter} rows={9} className="mt-3 resize-none bg-surface-sunken" aria-label="Your cover letter" />
      <Button size="sm" variant="ghost" className="mt-2" onClick={handleDownloadCv} disabled={downloadingCv}>
        <DownloadIcon className="h-3.5 w-3.5" />
        {downloadingCv ? "Preparing…" : "Download the tailored CV"}
      </Button>
    </div>
  );

  /* ── Loading ── */
  if (stage === "loading") {
    return shell(
      <div className={cn(cardCls, "p-8 text-center sm:p-12")} aria-busy="true">
        <Spinner size="lg" label="Tailoring your CV" />
        <p className="mt-4 font-serif text-title-serif text-ink">Tailoring your CV for this job</p>
        <p className="mt-2 text-body-sm text-ink-muted">
          Claude is adjusting your CV and writing a cover letter. This takes about 15 seconds and uses one of your monthly CV tailorings.
        </p>
        <div className="mx-auto mt-8 max-w-md space-y-2 text-left">
          <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-4/6" />
        </div>
      </div>
    );
  }

  /* ── Error ── */
  if (stage === "error") {
    return shell(
      <StatePanel
        role="alert"
        title={upgradeUrl ? (limitKind === "autoApply" ? "You've used this month's auto-applies" : "You've used this month's CV tailorings") : manualUrl ? "Apply to this one yourself" : "Something went wrong"}
        action={
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            {upgradeUrl && <Link href={upgradeUrl} className={buttonStyles({ size: "lg" })}>See plans</Link>}
            {manualUrl && openJob("Open the job")}
            <Button variant="secondary" size="lg" onClick={() => router.push("/dashboard/matches")}>Back to matches</Button>
          </div>
        }
      >
        {upgradeUrl ? `Your limit resets at the start of next month. A higher plan gives you more ${limitKind === "autoApply" ? "auto-applies" : "tailorings"} each month.${limitKind === "autoApply" ? " Nothing was sent, and you can still apply on LinkedIn yourself." : ""}` : error}
        {manualUrl && <span className="mt-2 block">Your tailored cover letter is saved in Applications.</span>}
      </StatePanel>
    );
  }

  /* ── LinkedIn: extension missing or too old. Nothing marked or charged. ── */
  if (stage === "extension_required") {
    const outdated = extensionProblem === "outdated";
    return shell(
      <StatePanel
        role="status"
        title={outdated ? "Update the JobAgent extension" : "Install the JobAgent extension"}
        action={
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" className={buttonStyles({ size: "lg" })}>
              {outdated ? "Get the update" : "Get the extension"} <span aria-hidden="true">↗</span>
            </a>
            <Button variant="secondary" size="lg" onClick={() => { setConfirming(false); setStage("ready"); }}>Try again</Button>
            {openJob("Apply on LinkedIn yourself")}
          </div>
        }
      >
        {outdated
          ? "Your version filled in answers you never gave, so JobAgent no longer applies with it. Update the extension, reload this page, and confirm again."
          : "JobAgent applies on LinkedIn through its Chrome extension, and it isn't answering in this browser. Install it, reload this page, and confirm again."}
        <span className="mt-2 block">Nothing was sent and no auto-apply was used.</span>
      </StatePanel>
    );
  }

  /* ── LinkedIn: extension working in its own tab ── */
  if (stage === "applying_background") {
    const done = bgStatus === "applied";
    const manual = !!bgStatus && MANUAL_STATUSES.has(bgStatus);
    if (done) {
      return shell(<StatePanel role="status" title="Application submitted" action={toApplications}>Taking you to your applications…</StatePanel>);
    }
    if (manual) {
      return shell(
        <>
          <StatePanel role="status" title="Finish this one yourself" action={<div className="flex flex-col items-center gap-3 sm:flex-row">{openJob("Open the job")}{toApplications}</div>}>
            JobAgent stopped before submitting. Either this job doesn&apos;t offer Easy Apply, or LinkedIn asked something you haven&apos;t given it an answer for. Nothing was sent and your auto-apply was returned. Finish the application in the LinkedIn tab.
          </StatePanel>
          {coverLetterCopy}
        </>
      );
    }
    return shell(
      <StatePanel
        role="status"
        title={bgTimedOut ? "Still not finished" : "Applying on LinkedIn"}
        action={toApplications}
      >
        {bgTimedOut ? (
          "We haven't heard back from the extension in 5 minutes. Check the LinkedIn tab; Applications shows the result once it reports in."
        ) : (
          <span className="inline-flex flex-col items-center gap-3">
            <Spinner size="lg" decorative />
            The extension is filling in the Easy Apply form in the LinkedIn tab. You&apos;ll get a Chrome notification when it&apos;s done.
          </span>
        )}
      </StatePanel>
    );
  }

  /* ── LinkedIn: plain tab opened (extension didn't answer) ── */
  if (stage === "extension_launched") {
    return shell(
      <StatePanel role="status" title="LinkedIn is open in a new tab" action={toApplications}>
        If the JobAgent extension is installed and you&apos;re signed in to LinkedIn, it fills in the Easy Apply form there. If nothing happens,{" "}
        <a
          href="https://chromewebstore.google.com/detail/jobagent-%E2%80%94-ai-job-assista/cjcfjidmlmclbemjoobdipjlcdbkldda"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-brand-text underline underline-offset-4"
        >
          install the extension
        </a>{" "}
        or apply in that tab yourself.
      </StatePanel>
    );
  }

  /* ── Submitting / result ── */
  if (stage === "submitting") {
    if (submitResult?.status === "timeout") {
      return shell(
        <StatePanel role="status" title="This is taking longer than expected" action={toApplications}>
          The application may still have gone through. Check the job site or your email for a confirmation, then set the status in Applications.
        </StatePanel>
      );
    }
    if (submitResult?.status === "manual") {
      return shell(
        <>
          <StatePanel role="status" title="Finish this one yourself" action={<div className="flex flex-col items-center gap-3 sm:flex-row">{openJob("Open the job")}{toApplications}</div>}>
            {submitResult.message || "This job can't be applied to automatically."} Your tailored cover letter is below, ready to paste.
          </StatePanel>
          {coverLetterCopy}
        </>
      );
    }
    if (submitResult) {
      const stillRunning = submitResult.status === "applying";
      return shell(
        <StatePanel role="status" title={stillRunning ? "Submitting your application" : "Application submitted"} action={toApplications}>
          {submitResult.message} <span className="mt-2 block text-body-sm">Taking you to your applications…</span>
        </StatePanel>
      );
    }
    return shell(
      <StatePanel role="status" title="Submitting your application">
        <span className="inline-flex flex-col items-center gap-3">
          <Spinner size="lg" decorative />
          This can take up to a minute. Please keep this page open.
        </span>
      </StatePanel>
    );
  }

  /* ── Ready: review before applying ── */
  const d = data!;
  const lowMatch = d.match_score !== null && d.match_score !== undefined && d.match_score < 0.45;
  const plan = submitPlan(d.job_url);

  const answerRows: { label: string; value: string; needsApproval?: boolean }[] = answers
    ? [
        { label: "Name", value: [answers.first_name, answers.last_name].filter(Boolean).join(" ") },
        { label: "Phone", value: answers.phone ?? "" },
        { label: "City", value: answers.city ?? "" },
        { label: "Expected salary (monthly, NIS)", value: answers.expected_salary ?? "" },
        { label: "Total years of experience", value: answers.years_of_experience ?? "", needsApproval: true },
        { label: "Highest education", value: answers.highest_education ?? "", needsApproval: true },
        { label: "Notice period (days)", value: answers.notice_period ?? "", needsApproval: true },
        { label: "Authorized to work in Israel", value: yesNo(answers.work_authorized), needsApproval: true },
        { label: "Requires visa sponsorship", value: yesNo(answers.requires_sponsorship), needsApproval: true },
        { label: "Willing to relocate", value: yesNo(answers.willing_to_relocate), needsApproval: true },
      ]
    : [];
  const approved = !!answers?.application_details_confirmed;
  const awaitingApproval = !!answers && !approved && answerRows.some((r) => r.needsApproval && r.value);

  const linkedInReview = (
    <>
      <section aria-labelledby="li-heading" className={cn(cardCls, "p-5 sm:p-8")}>
        <h2 id="li-heading" className="font-serif text-feature-sm text-ink">What LinkedIn receives</h2>
        <p className="mt-3 text-body text-ink">
          LinkedIn Easy Apply sends the résumé saved on your LinkedIn profile. JobAgent doesn&apos;t send a CV or a cover letter for this job, so nothing was tailored and no CV tailoring was used.
        </p>
        <Notice tone="info" className="mt-4">
          We&apos;ll check whether this job offers Easy Apply when LinkedIn opens. If it doesn&apos;t, nothing is submitted, your auto-apply is returned, and you finish on LinkedIn yourself.
        </Notice>
        <p className="mt-3 text-body-sm text-ink-muted">
          Want a CV tailored to this role to upload yourself?{" "}
          <Link href={`/dashboard/apply/${jobId}?mode=download`} className="font-semibold text-brand-text underline underline-offset-4">
            Tailor and download one
          </Link>{" "}
          (uses one CV tailoring).
        </p>
      </section>

      <section aria-labelledby="answers-heading" className={cn(cardCls, "p-5 sm:p-8")}>
        <h2 id="answers-heading" className="font-serif text-feature-sm text-ink">Answers the extension will use</h2>
        <p className="mt-2 text-body-sm text-ink-muted">
          Each one is used only for the matching question, along with answers you&apos;ve typed for a question before. Anything else LinkedIn asks is left blank. If a blank question is required, JobAgent stops without submitting and you answer it yourself.
        </p>

        {!answers ? (
          <div className="mt-5 space-y-3" aria-busy="true">
            <Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-3/5" />
          </div>
        ) : (
          <dl className="mt-5 divide-y divide-line border-y border-line">
            {answerRows.map((row) => {
              const held = !!row.needsApproval && !approved;
              return (
                <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
                  <dt className="text-body-sm text-ink-muted">{row.label}</dt>
                  <dd className={cn("text-body-sm font-medium", row.value && !held ? "text-ink" : "text-ink-subtle")}>
                    {row.value || "No answer: left blank"}
                    {row.value && held && <span className="font-normal"> · not used until you approve</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}

        {awaitingApproval && (
          <Notice tone="attention" title="Check the last six before you apply" className="mt-5">
            Until you approve them or save them in Profile, JobAgent leaves those questions blank.
          </Notice>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {awaitingApproval && (
            <Button variant="secondary" onClick={approveAnswers} disabled={approving} loading={approving}>
              These are correct
            </Button>
          )}
          <Link href="/dashboard/profile" className="text-body-sm font-semibold text-brand-text underline underline-offset-4">
            Edit in Profile
          </Link>
        </div>
      </section>
    </>
  );

  return shell(
    <div className="grid items-start gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {d.linkedin ? linkedInReview : (<>
        <section aria-labelledby="letter-heading" className={cn(cardCls, "p-5 sm:p-8")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="letter-heading" className="font-serif text-feature-sm text-ink">Cover letter</h2>
            {isDownloadMode ? (
              <Button size="sm" variant="ghost" onClick={copyLetter}>Copy</Button>
            ) : (
              <span className="text-caption text-ink-subtle">Edit anything before you apply</span>
            )}
          </div>
          {isDownloadMode && (
            <p className="mt-1 text-body-sm text-ink-muted">Edit it here, then copy it into the application. Edits aren&apos;t saved when you leave this page.</p>
          )}
          <Textarea
            aria-labelledby="letter-heading"
            value={coverLetter}
            onChange={(e) => setCoverLetter(e.target.value)}
            rows={14}
            className="mt-4 resize-y leading-relaxed"
          />
        </section>

        <section aria-labelledby="cv-heading" className={cn(cardCls, "overflow-hidden")}>
          <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:px-8 sm:py-6">
            <div>
              <h2 id="cv-heading" className="font-serif text-feature-sm text-ink">{isDownloadMode ? "Your tailored CV" : "The CV that will be sent"}</h2>
              <p className="mt-1 text-body-sm text-ink-muted">
                {isDownloadMode ? "Tailored by Claude for this job. Download it and attach it when you apply." : "Your CV, tailored by Claude for this job."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowCv((v) => !v)} aria-expanded={showCv} aria-controls="tailored-cv">
                {showCv ? "Hide" : "Show CV"}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDownloadCv} disabled={downloadingCv}>
                <DownloadIcon className="h-3.5 w-3.5" />
                {downloadingCv ? "Preparing…" : "Download"}
              </Button>
            </div>
          </div>
          {showCv && (
            <div id="tailored-cv" className="max-h-[70vh] overflow-y-auto border-t border-line px-6 py-8 sm:px-12">
              {d.tailored_cv ? <CVText text={d.tailored_cv} /> : <p className="text-body-sm text-ink-muted">No tailored CV text was returned for this application.</p>}
            </div>
          )}
        </section>
        </>)}
      </div>

      <aside className="space-y-6 lg:sticky lg:top-6">
        <section aria-labelledby="summary-heading" className={cn(cardCls, "p-5 sm:p-6")}>
          <h2 id="summary-heading" className={groupLabel}>{isDownloadMode ? "Apply on their site" : "When you confirm"}</h2>
          {isDownloadMode ? (
            <p className="mt-2 text-body-sm text-ink-muted">JobAgent doesn&apos;t send anything for this job. Download the tailored CV, then apply on the company&apos;s site and paste in the cover letter.</p>
          ) : (
            <>
              <p className="mt-2 text-body font-semibold text-ink">{plan.title}</p>
              <p className="mt-1 text-body-sm text-ink-muted">{plan.detail}</p>
            </>
          )}

          {lowMatch && !d.linkedin && (
            <Notice tone="attention" className="mt-4">
              This role may not match your background well, so Claude kept its changes small rather than overstate your experience.
            </Notice>
          )}

          <div className="mt-5 flex flex-col gap-2">
            {isDownloadMode ? (
              <>
                <Button size="lg" block onClick={handleDownloadCv} disabled={downloadingCv} loading={downloadingCv}>
                  <DownloadIcon className="h-4 w-4" />
                  {downloadingCv ? "Preparing…" : "Download CV"}
                </Button>
                <a href={d.job_url} target="_blank" rel="noopener noreferrer" className={buttonStyles({ variant: "secondary", size: "lg", block: true })}>
                  View job <span aria-hidden="true">↗</span>
                </a>
              </>
            ) : (
              <Button variant="accent" size="lg" block onClick={handleConfirm} disabled={confirming} loading={confirming}>
                {confirming ? "Saving…" : "Confirm & apply"}
              </Button>
            )}
            <Button variant="ghost" size="lg" block onClick={() => router.push("/dashboard/matches")} disabled={confirming}>Cancel</Button>
          </div>
          <a href={d.job_url} target="_blank" rel="noopener noreferrer" className="mt-3 block text-center text-body-sm font-medium text-brand-text underline-offset-4 hover:underline">
            Read the job posting <span aria-hidden="true">↗</span>
          </a>
        </section>

        {d.cv_changes.length > 0 && (
          <section aria-labelledby="changes-heading" className={cn(cardCls, "p-5 sm:p-6")}>
            <h2 id="changes-heading" className={groupLabel}>What Claude changed</h2>
            <ul className="mt-3 space-y-2">
              {d.cv_changes.map((change, i) => (
                <li key={i} className="flex gap-2.5 text-body-sm text-ink">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {change}
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>,
    true,
  );
}
