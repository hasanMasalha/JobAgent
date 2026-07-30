import type { Metadata } from "next";
import { LegalHeader, Section, LegalList } from "../legal-ui";

export const metadata: Metadata = {
  title: "Privacy Policy — JobAgent",
};

const LAST_UPDATED = "July 30, 2026";

export default function PrivacyPolicyPage() {
  return (
    <>
      <LegalHeader title="Privacy Policy" lastUpdated={LAST_UPDATED} />

      <Section title="1. What Data We Collect">
        <p>To provide the Service, we collect and store:</p>
        <LegalList
          items={[
            "Account information: your name and email address.",
            "Your CV: the raw text of your uploaded or AI-built CV, an AI-generated summary, and extracted skills.",
            "Job preferences: titles, locations, work-mode and salary preferences, and job categories you select.",
            "Application data: which jobs you've saved, dismissed, or applied to, and the status of those applications.",
            "Connected-account tokens: if you choose to connect them, Google Calendar access tokens (for interview scheduling) and a LinkedIn session (for Easy Apply automation).",
            "Billing information: handled by our payment processor, Paddle — we store your plan and subscription status, not your card details.",
          ]}
        />
      </Section>

      <Section title="2. How We Use Your Data">
        <LegalList
          items={[
            "Matching: your CV and preferences are converted into vector embeddings and compared against scraped job listings to find relevant matches.",
            "Auto-apply: when enabled, your CV, contact details, and saved answers are used to fill out and submit application forms on your behalf.",
            "CV tailoring: when you apply to a specific job, an AI model may tailor your CV or draft a cover letter for that application.",
            "Notifications: your email address is used to send daily match emails and account-related notifications, which you can opt out of at any time.",
            "Product improvement: aggregated, non-identifying usage data helps us improve matching quality and the application flow.",
          ]}
        />
      </Section>

      <Section title="3. Third-Party Services">
        <p>We rely on the following third-party services to operate JobAgent. Each processes a subset of your data solely to provide their service to us:</p>
        <LegalList
          items={[
            <>
              <strong>Supabase</strong> — hosts our PostgreSQL database and handles authentication. Your
              account credentials, CV, preferences, and application history are stored here.
            </>,
            <>
              <strong>Paddle</strong> — our merchant of record for subscription billing. Paddle processes
              your payment details directly; we never see or store your full card number.
            </>,
            <>
              <strong>Anthropic (Claude)</strong> — used for CV extraction on upload, daily job-match
              scoring, CV tailoring when you apply, and the in-app chat assistant. Relevant CV and job text
              is sent to Anthropic&apos;s API to generate these results.
            </>,
          ]}
        />
        <p>
          We do not sell your personal data to third parties, and we do not share it with employers except
          through the application you explicitly submit.
        </p>
      </Section>

      <Section title="4. Data Retention">
        <p>
          We retain your account data for as long as your account is active, so the Service can continue
          matching you to new jobs. If you delete your account, we delete your CV, preferences, and
          connected-account tokens, and anonymize or delete your application history within a reasonable
          period, except where we are required to retain limited records (e.g. billing records) for legal or
          accounting purposes.
        </p>
      </Section>

      <Section title="5. Your Rights">
        <p>You can, at any time:</p>
        <LegalList
          items={[
            "Access or update your CV, profile, and preferences from your account settings.",
            "Delete your account and associated personal data.",
            "Disconnect Google Calendar or your LinkedIn session at any time.",
            "Unsubscribe from email notifications with one click.",
            <>
              Request a copy of the personal data we hold about you, or ask us to correct or erase it, by
              emailing{" "}
              <a href="mailto:privacy@jobagent.uk" className="text-[#1a2e5e] dark:text-blue-400 underline">
                privacy@jobagent.uk
              </a>
              .
            </>,
          ]}
        />
      </Section>

      <Section title="6. GDPR">
        <p>
          If you are located in the European Economic Area or United Kingdom, you have rights under the
          General Data Protection Regulation (GDPR), including the rights of access, rectification, erasure,
          restriction of processing, data portability, and objection described above. We process your data
          on the basis of your consent (for optional features like Google Calendar and email notifications)
          and contractual necessity (to provide the Service you signed up for).
        </p>
      </Section>

      <Section title="7. Contact">
        <p>
          Questions about this Privacy Policy or how we handle your data? Email us at{" "}
          <a href="mailto:privacy@jobagent.uk" className="text-[#1a2e5e] dark:text-blue-400 underline">
            privacy@jobagent.uk
          </a>
          .
        </p>
      </Section>
    </>
  );
}
