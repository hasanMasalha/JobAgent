import Link from "next/link";
import { LegalFrame, LegalList, Section, legalLink } from "../legal/legal-ui";

// The Chrome extension's privacy policy. It keeps the /privacy URL because
// the Chrome Web Store listing links here; the site-wide policy is
// /legal/privacy. Keep it in step with what chrome-extension/ actually
// stores and sends — the Store reviews the listing against it.

export const metadata = {
  title: "Privacy Policy — JobAgent",
  description: "JobAgent Chrome Extension privacy policy",
};

export default function PrivacyPage() {
  return (
    <LegalFrame>
      <div className="mb-10">
        <h1 className="font-serif text-title-page text-ink">Privacy Policy</h1>
        <p className="mt-2 text-body-sm text-ink-subtle">JobAgent Chrome Extension (version 1.1.1) — Last updated: 29 September 2026</p>
      </div>

      <Section title="What the Extension Does">
        <p>
          The JobAgent Chrome Extension fills in LinkedIn Easy Apply forms for applications you
          start in JobAgent. This policy covers what the extension itself stores and sends. How
          JobAgent handles your account data is covered by our main{" "}
          <Link href="/legal/privacy" className={legalLink}>Privacy Policy</Link>.
        </p>
      </Section>

      <Section title="What Is Stored on Your Device">
        <p>The extension keeps the following in <Code>chrome.storage.local</Code>, on your device only:</p>
        <LegalList
          items={[
            "A sign-in token for JobAgent, so the extension can make requests for your account. It expires after 14 days and is renewed when you visit jobagent.uk.",
            "Your JobAgent user ID and email, to show your account in the popup and find your pending applications.",
            "The applications you queued from JobAgent and how far through them it is, so it can fill them one at a time.",
          ]}
        />
        <p>
          The popup also reads LinkedIn&apos;s <Code>li_at</Code> cookie to show whether you&apos;re
          signed in to LinkedIn. It is read on your device only and never sent anywhere.
        </p>
      </Section>

      <Section title="What Is Sent to JobAgent">
        <p>The extension sends data only to jobagent.uk:</p>
        <div className="overflow-x-auto">
          <table className="mt-1 w-full border-collapse text-body-sm">
            <thead>
              <tr className="bg-surface-sunken text-left text-ink">
                <Th>Data</Th>
                <Th>When</Th>
                <Th>Why</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <Td>Your answers to application questions the extension doesn&apos;t recognise (the question and your answer)</Td>
                <Td>When you answer such a question in an Easy Apply form</Td>
                <Td>Saved to your JobAgent account and reused on later applications. You can see, edit or delete them in Profile → Saved answers.</Td>
              </tr>
              <tr>
                <Td>The outcome of an application (submitted, or needs you to finish it yourself) and the application&apos;s ID</Td>
                <Td>When a form is submitted or stops</Td>
                <Td>Updates your applications tracker in JobAgent.</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="What the Extension Receives from JobAgent">
        <p>
          To fill a form you started from JobAgent, the extension downloads, for that application
          only: the details you entered in Profile → Application details (name, phone, city,
          profile links, experience, education, notice period, expected salary and eligibility
          answers), the skills from your CV, your saved answers, and the cover letter for that job.
          It uses them to fill the form in your browser and does not keep them after the application.
        </p>
      </Section>

      <Section title="What the Extension Does Not Do">
        <LegalList
          items={[
            "It does not read your browsing history, or pages other than LinkedIn and jobagent.uk.",
            "It does not sell or share your data with third parties. Apart from the application you submit to an employer through LinkedIn, it sends data only to jobagent.uk.",
            "It does not use analytics or tracking services.",
          ]}
        />
      </Section>

      <Section title="Permissions">
        <LegalList
          items={[
            <><strong className="font-semibold text-ink">Access to linkedin.com and jobagent.uk:</strong> to fill Easy Apply forms on LinkedIn job pages, and to pick up your sign-in when you use jobagent.uk.</>,
            <><strong className="font-semibold text-ink">Cookies:</strong> to read your LinkedIn sign-in status for the popup.</>,
            <><strong className="font-semibold text-ink">Storage:</strong> for the data listed under &ldquo;What Is Stored on Your Device&rdquo;.</>,
            <><strong className="font-semibold text-ink">Notifications:</strong> to tell you when an application is submitted, needs you to finish it, or is paused.</>,
            <><strong className="font-semibold text-ink">Active tab and scripting:</strong> to fill in the form on the LinkedIn page you are applying on.</>,
          ]}
        />
      </Section>

      <Section title="Data Retention">
        <p>
          Data in <Code>chrome.storage.local</Code> stays on your device until you uninstall the
          extension or clear its storage via <Code>chrome://extensions</Code> → JobAgent → Storage;
          the sign-in token stops working after 14 days. Saved answers stay in your JobAgent account
          until you delete them in Profile → Saved answers.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For questions about this privacy policy, contact us at{" "}
          <a href="mailto:support@jobagent.uk" className={legalLink}>support@jobagent.uk</a>.
        </p>
      </Section>

      <p className="mt-10 border-t border-line pt-6 text-center text-caption text-ink-subtle">© 2026 JobAgent. All rights reserved.</p>
    </LegalFrame>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="px-3 py-2 font-semibold">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 align-top text-ink-muted">{children}</td>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded-sm bg-surface-sunken px-1.5 py-0.5 font-mono text-[0.8125rem] text-ink">{children}</code>;
}
