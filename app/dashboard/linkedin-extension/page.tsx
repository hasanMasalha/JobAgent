"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Checkbox, Notice, PageHero, SkeletonCard, StatePanel, buttonStyles } from "@/app/components/ui";
import { cn } from "@/lib/cn";
import { EXTENSION_STORE_URL } from "@/lib/extension-client";
import { isSafeNext } from "@/lib/linkedin-consent";

const cardCls = "rounded-[1.375rem] bg-surface-raised shadow-dossier ring-1 ring-line/60";

// The LinkedIn automation risk notice, at the point of decision: the nav's
// "Get the extension", the LinkedIn review screen's Confirm and batch Easy
// Apply on Matches all come here until the user has accepted it. Accepting
// records User.linkedin_automation_consent_at, then goes back to ?next= or
// shows the extension setup.
function LinkedInExtensionSetup() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [consented, setConsented] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/linkedin/automation-consent")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't load this page");
        setConsented(!!data.consented);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  async function accept() {
    if (!understood) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/linkedin/automation-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ understood: true }),
      });
      if (!res.ok) throw new Error();
      if (isSafeNext(next)) {
        router.push(next);
        return;
      }
      setConsented(true);
    } catch {
      setSaveError("Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full">
      <PageHero title="LinkedIn Easy Apply" />

      <div className="relative mx-auto -mt-14 max-w-2xl pb-24 sm:-mt-16 sm:pb-10">
        {consented === null && !loadError && <SkeletonCard />}
        {loadError && <StatePanel role="alert" title="Couldn't load this page">{loadError}</StatePanel>}

        {consented === false && (
          <section aria-labelledby="risk-heading" className={cn(cardCls, "p-5 sm:p-8")}>
            <Notice tone="attention">
              <h2 id="risk-heading" className="font-semibold">⚠ Important</h2>
              <p className="mt-1">
                JobAgent&apos;s LinkedIn extension automates actions in your browser. LinkedIn&apos;s User
                Agreement restricts automated activity, and using automation may result in your LinkedIn
                account being restricted.
              </p>
            </Notice>
            <p className="mt-4 text-body text-ink">Using this feature is optional.</p>

            <Checkbox
              className="mt-5 items-start"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              label="I understand that using automation on LinkedIn may result in account restrictions and I choose to continue."
            />

            {saveError && <Notice tone="danger" className="mt-4">{saveError}</Notice>}

            <div className="mt-6 flex flex-wrap gap-2">
              <Button size="lg" onClick={accept} disabled={!understood || saving} loading={saving}>
                Continue to LinkedIn setup
              </Button>
              <Link href={isSafeNext(next) ? next : "/dashboard"} className={buttonStyles({ variant: "ghost", size: "lg" })}>
                Not now
              </Link>
            </div>
          </section>
        )}

        {consented === true && (
          <section aria-labelledby="setup-heading" className={cn(cardCls, "p-5 sm:p-8")}>
            <h2 id="setup-heading" className="font-serif text-feature-sm text-ink">Set up the extension</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-body text-ink">
              <li>Install the JobAgent extension from the Chrome Web Store.</li>
              <li>Stay signed in to LinkedIn in the same browser.</li>
              <li>Pick an Easy Apply job in your matches and press Apply. You review it before anything is sent.</li>
            </ol>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" className={buttonStyles({ size: "lg" })}>
                Get the extension <span aria-hidden="true">↗</span>
              </a>
              <Link href={isSafeNext(next) ? next : "/dashboard/matches"} className={buttonStyles({ variant: "secondary", size: "lg" })}>
                {isSafeNext(next) ? "Back" : "Go to matches"}
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function LinkedInExtensionPage() {
  return (
    <Suspense fallback={null}>
      <LinkedInExtensionSetup />
    </Suspense>
  );
}
