"use client";

import { useEffect, useState } from "react";
import { showToast } from "@/app/components/Toast";
import { Button, Notice, Skeleton, buttonStyles } from "@/app/components/ui";
import { cn } from "@/lib/cn";

// Fill-and-review: the real application form's questions with JobAgent's
// answer to each, for applying by hand (/api/apply/form-answers). The same
// answers the extension will type: facts only from the user's own data,
// Claude only for open-ended free text, nothing guessed. Greenhouse and Ashby
// forms so far; for anything else this renders nothing.

interface FormQuestion {
  id: string;
  label: string;
  kind: string;
  required: boolean;
  role: string | null;
  eeo: boolean;
}

interface FormAnswer {
  id: string;
  source: string;
  value?: string;
  option?: string;
  options?: string[];
}

interface FormAnswersResult {
  supported: boolean;
  form_url: string | null;
  questions?: FormQuestion[];
  answers?: FormAnswer[];
  missing?: { id: string; label: string }[];
}

const cardCls = "rounded-[1.375rem] bg-surface-raised shadow-dossier ring-1 ring-line/60";

const SOURCE: Record<string, string> = {
  profile: "From your Profile",
  saved: "Your saved answer",
  claude: "Written by Claude from your CV — read it before you paste it",
  consent: "Consent to process your application",
  eeo_decline: "Voluntary question — “decline to self-identify”",
  phone_country: "From your phone number",
  cover_letter: "Your cover letter",
};

function answerText(a: FormAnswer): string {
  if (a.options?.length) return a.options.join(", ");
  if (a.option) return a.option;
  if (a.value === "yes") return "Yes";
  if (a.value === "no") return "No";
  return a.value ?? "";
}

export default function FormAnswers({ applicationId }: { applicationId: string }) {
  const [data, setData] = useState<FormAnswersResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/apply/form-answers/${applicationId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const json = (await res.json()) as FormAnswersResult;
        if (!cancelled) setData(json);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (failed) {
    return (
      <Notice tone="info">We couldn&apos;t read this job&apos;s application form, so there are no prepared answers. You can still apply with the CV and cover letter here.</Notice>
    );
  }
  if (!data) {
    return (
      <section aria-busy="true" className={cn(cardCls, "space-y-3 p-5 sm:p-8")}>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <span className="sr-only" role="status">Reading the application form</span>
      </section>
    );
  }
  if (!data.supported || !data.questions) return null;

  const answers = new Map((data.answers ?? []).map((a) => [a.id, a]));
  const missing = new Set((data.missing ?? []).map((m) => m.id));
  const answered = data.questions.filter((q) => answers.has(q.id)).length;

  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(() => showToast("Copied", "success"), () => showToast("Couldn't copy", "error"));

  return (
    <section aria-labelledby="form-answers-heading" className={cn(cardCls, "p-5 sm:p-8")}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="form-answers-heading" className="font-serif text-feature-sm text-ink">Answers for this form</h2>
        {data.form_url && (
          <a href={data.form_url} target="_blank" rel="noopener noreferrer" className={buttonStyles({ size: "sm" })}>
            Open the application form <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
      <p className="mt-2 text-body-sm text-ink-muted">
        {answered} of {data.questions.length} questions answered from what you&apos;ve given JobAgent.
        {missing.size > 0 && <> {missing.size} required {missing.size === 1 ? "question needs" : "questions need"} your answer — JobAgent doesn&apos;t guess facts.</>}
      </p>

      <ol className="mt-5 divide-y divide-line">
        {data.questions.map((q) => {
          const a = answers.get(q.id);
          const text = a ? answerText(a) : "";
          return (
            <li key={q.id} className="py-4 first:pt-0 last:pb-0">
              <p className="text-body-sm font-medium text-ink">
                {q.label || q.id}
                {q.required && <span className="ml-1.5 text-caption font-normal text-ink-subtle">Required</span>}
              </p>

              {q.role === "resume" ? (
                <p className="mt-1.5 text-body-sm text-ink-muted">Attach your tailored CV — download it from this page.</p>
              ) : a && text ? (
                <div className="mt-2 flex items-start gap-2">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap rounded-control bg-surface-sunken px-3 py-2 text-body-sm text-ink">{text}</p>
                  <Button size="sm" variant="ghost" onClick={() => copy(text)} aria-label={`Copy the answer to: ${q.label}`}>
                    Copy
                  </Button>
                </div>
              ) : missing.has(q.id) ? (
                <p className="mt-1.5 text-body-sm font-medium text-attention-text">You answer this one.</p>
              ) : (
                <p className="mt-1.5 text-body-sm text-ink-subtle">Optional — answer it yourself or leave it blank.</p>
              )}

              {a && SOURCE[a.source] && q.role !== "resume" && (
                <p className={cn("mt-1 text-caption", a.source === "claude" ? "text-attention-text" : "text-ink-subtle")}>{SOURCE[a.source]}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
