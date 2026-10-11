"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Checkbox, Notice, PageHero, SkeletonCard, StatePanel, buttonStyles } from "@/app/components/ui";
import { cn } from "@/lib/cn";
import { EXTENSION_STORE_URL, extensionReadiness } from "@/lib/extension-client";
import { MIN_ATS_EXTENSION_VERSION } from "@/lib/extension-version";
import { isSafeNext } from "@/lib/linkedin-consent";

const cardCls = "rounded-[1.375rem] bg-surface-raised shadow-dossier ring-1 ring-line/60";

// Before the extension applies on an employer's job site (Greenhouse): what it
// does, the box to tick (User.job_site_automation_consent_at), and installing
// or updating it to 1.6.0. Apply on a Greenhouse job comes here when either is
// missing; ?job= offers fill-and-review for that job instead, so the user
// isn't stuck.
function JobSiteExtensionSetup() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const jobId = params.get("job");
  const [consented, setConsented] = useState<boolean | null>(null);
  const [readiness, setReadiness] = useState<"ok" | "missing" | "outdated" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/apply/job-site-consent")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't load this page");
        setConsented(!!data.consented);
      })
      .catch((err) => setLoadError(err.message));
    extensionReadiness(MIN_ATS_EXTENSION_VERSION).then(setReadiness);
  }, []);

  async function accept() {
    if (!understood) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/apply/job-site-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ understood: true }),
      });
      if (!res.ok) throw new Error();
      setConsented(true);
    } catch {
      setSaveError("Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const back = isSafeNext(next) ? next : "/dashboard/matches";
  const fillAndReview = jobId && (
    <Link href={`/dashboard/apply/${encodeURIComponent(jobId)}?mode=download`} className={buttonStyles({ variant: "secondary", size: "lg" })}>
      Prepare it for me to submit instead
    </Link>
  );

  return (
    <div className="w-full">
      <PageHero title="Applying on company job sites" />

      <div className="relative mx-auto -mt-14 max-w-2xl space-y-6 pb-24 sm:-mt-16 sm:pb-10">
        {(consented === null || readiness === null) && !loadError && <SkeletonCard />}
        {loadError && <StatePanel role="alert" title="Couldn't load this page">{loadError}</StatePanel>}

        {consented === false && readiness !== null && (
          <section aria-labelledby="notice-heading" className={cn(cardCls, "p-5 sm:p-8")}>
            <h2 id="notice-heading" className="font-serif text-feature-sm text-ink">What the extension does here</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-body text-ink">
              <li>
                When you press Apply on a job hosted on Greenhouse, the JobAgent extension opens the company&apos;s
                application form in your browser, fills it in and submits it for you.
              </li>
              <li>
                It receives your CV from JobAgent to attach to the application, and your answers to the form&apos;s
                questions. It answers only with what you&apos;ve given JobAgent; if a required question has no answer
                from you, it stops without submitting and leaves the form open.
              </li>
              <li>
                It submits under your name, to the employer. Some employers&apos; sites have terms about automated
                applications, and an employer may treat it as one.
              </li>
              <li>Chrome will ask you to allow the extension to access greenhouse.io the first time.</li>
            </ul>
            <p className="mt-4 text-body text-ink">Using this feature is optional.</p>

            <Checkbox
              className="mt-5 items-start"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              label="I understand that the extension will fill in and submit applications on employers' job sites for me, with my CV and my answers, and I choose to continue."
            />

            {saveError && <Notice tone="danger" className="mt-4">{saveError}</Notice>}

            <div className="mt-6 flex flex-wrap gap-2">
              <Button size="lg" onClick={accept} disabled={!understood || saving} loading={saving}>
                Continue
              </Button>
              {fillAndReview}
              <Link href={back} className={buttonStyles({ variant: "ghost", size: "lg" })}>Not now</Link>
            </div>
          </section>
        )}

        {consented === true && readiness !== null && readiness !== "ok" && (
          <section aria-labelledby="install-heading" className={cn(cardCls, "p-5 sm:p-8")}>
            <h2 id="install-heading" className="font-serif text-feature-sm text-ink">
              {readiness === "outdated" ? "Update the JobAgent extension" : "Install the JobAgent extension"}
            </h2>
            <p className="mt-2 text-body text-ink-muted">
              {readiness === "outdated"
                ? `Applying on company job sites needs version ${MIN_ATS_EXTENSION_VERSION} or later. Chrome updates extensions on its own within a few hours; to update now, open chrome://extensions, turn on Developer mode and press Update.`
                : "Applying on company job sites works through the JobAgent Chrome extension. Install it, then reload this page."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" className={buttonStyles({ size: "lg" })}>
                {readiness === "outdated" ? "Open in the Chrome Web Store" : "Get the extension"} <span aria-hidden="true">↗</span>
              </a>
              {fillAndReview}
              <Link href={back} className={buttonStyles({ variant: "ghost", size: "lg" })}>Back</Link>
            </div>
          </section>
        )}

        {consented === true && readiness === "ok" && (
          <section aria-labelledby="ready-heading" className={cn(cardCls, "p-5 sm:p-8")}>
            <h2 id="ready-heading" className="font-serif text-feature-sm text-ink">You&apos;re set up</h2>
            <p className="mt-2 text-body text-ink-muted">Press Apply on the job again and the extension takes it from there.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button size="lg" onClick={() => router.push(back)}>Back to the job</Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function JobSiteExtensionPage() {
  return (
    <Suspense fallback={null}>
      <JobSiteExtensionSetup />
    </Suspense>
  );
}
