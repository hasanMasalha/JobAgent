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
        <p className="mt-2 text-body-sm text-ink-subtle">JobAgent Chrome Extension (version 1.6.0) — Last updated: 12 October 2026</p>
      </div>

      <Section title="What the Extension Does">
        <p>
          The JobAgent Chrome Extension fills in and submits LinkedIn Easy Apply forms and
          Greenhouse application forms for applications you start in JobAgent. This policy covers what the extension itself stores and sends. How
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
            "For a Greenhouse application in progress: its ID, the tab it opened, how far it got and, once it clicks Submit, the text of the form page from just before — so it can tell Greenhouse's confirmation from text that was already on the page. Deleted when the application finishes.",
          ]}
        />
        <p>
          While it opens Easy Apply on a LinkedIn tab, it also keeps a short marker in{" "}
          <Code>chrome.storage.session</Code>: that it clicked Easy Apply in that tab and when. It
          contains nothing about you or the job, is used only for the extension&apos;s own error
          logs, and is held in memory — it&apos;s deleted when the application finishes or the browser
          closes.
        </p>
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
                <Td>The outcome of an application (submitted, or needs you to finish it yourself) and the application&apos;s ID; when it stopped at questions you haven&apos;t answered, those questions and their options</Td>
                <Td>When a form is submitted or stops</Td>
                <Td>Updates your applications tracker in JobAgent, which then asks you those questions so the next application can use your answers.</Td>
              </tr>
              <tr>
                <Td>The list of countries a Greenhouse form&apos;s phone-number picker offers</Td>
                <Td>When it fills a Greenhouse form with a phone country picker</Td>
                <Td>JobAgent picks the country of the phone number in your Profile from that list.</Td>
              </tr>
              <tr>
                <Td>The extension&apos;s version number</Td>
                <Td>With every request to JobAgent</Td>
                <Td>So JobAgent can refuse to work with a version that has a known problem.</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="What the Extension Receives from JobAgent">
        <p>
          To fill a form you started from JobAgent, the extension downloads, for that application
          only: your account email, the details you entered in Profile → Application details
          (name, phone, city, profile links, experience, education, notice period, expected salary
          and eligibility answers), the skills from your CV, and your saved answers. It uses them
          to fill the form in your browser and does not keep them after the application. It fills
          in a question only with an answer you have given; if LinkedIn requires a question you
          haven&apos;t answered, it stops without submitting. It does not upload a CV or a cover
          letter: LinkedIn Easy Apply uses the résumé saved on your LinkedIn profile.
        </p>
        <p>
          For a Greenhouse application it also downloads, for that application only: the
          form&apos;s questions with JobAgent&apos;s answer to each, your CV file (the CV tailored for
          that job, or else the file you uploaded to JobAgent) and the cover letter. It attaches
          the CV and the cover letter to the employer&apos;s Greenhouse form and does not keep them
          after the application. The same rule applies: if the form requires something you
          haven&apos;t given, it stops without submitting and leaves the form open for you.
        </p>
      </Section>

      <Section title="What the Extension Does Not Do">
        <LegalList
          items={[
            "It does not read your browsing history, or pages other than LinkedIn, jobagent.uk and the Greenhouse application forms it opens for you.",
            "It does not sell or share your data with third parties. Apart from the application you submit to an employer through LinkedIn or Greenhouse, it sends data only to jobagent.uk.",
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
            <><strong className="font-semibold text-ink">Access to greenhouse.io (optional):</strong> asked for the first time you apply to a Greenhouse job, and used only in the tab the extension opens for that application. You can remove it in Chrome&apos;s extension settings.</>,
            <><strong className="font-semibold text-ink">Active tab and scripting:</strong> to fill in the form on the LinkedIn page or Greenhouse form you are applying on.</>,
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
