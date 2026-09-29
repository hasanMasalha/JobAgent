import { LegalFrame, LegalList, Section, legalLink } from "../legal/legal-ui";

// The Chrome extension's privacy policy. It keeps the /privacy URL because
// the Chrome Web Store listing links here; the site-wide policy is
// /legal/privacy.

export const metadata = {
  title: "Privacy Policy — JobAgent",
  description: "JobAgent Chrome Extension privacy policy",
};

export default function PrivacyPage() {
  return (
    <LegalFrame>
      <div className="mb-10">
        <h1 className="font-serif text-title-page text-ink">Privacy Policy</h1>
        <p className="mt-2 text-body-sm text-ink-subtle">JobAgent Chrome Extension — Last updated: May 2026</p>
      </div>

      <Section title="What We Collect">
        <p>The JobAgent Chrome Extension collects and stores the following data:</p>
        <div className="overflow-x-auto">
          <table className="mt-1 w-full border-collapse text-body-sm">
            <thead>
              <tr className="bg-surface-sunken text-left text-ink">
                <Th>Data</Th>
                <Th>Purpose</Th>
                <Th>Storage</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <Td>JobAgent session token</Td>
                <Td>Authenticate API requests</Td>
                <Td><Code>chrome.storage.local</Code> (local device only)</Td>
              </tr>
              <tr>
                <Td>JobAgent user ID and email</Td>
                <Td>Display account status in popup</Td>
                <Td><Code>chrome.storage.local</Code> (local device only)</Td>
              </tr>
              <tr>
                <Td>LinkedIn <Code>li_at</Code> session cookie</Td>
                <Td>Detect LinkedIn login status</Td>
                <Td>Read-only; sent to JobAgent server to enable Easy Apply</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="What We Do Not Collect">
        <LegalList
          items={[
            "We do not collect browsing history",
            "We do not collect personal data beyond your JobAgent account email",
            "We do not sell or share any data with third parties",
            "We do not use analytics or tracking services",
          ]}
        />
      </Section>

      <Section title="How Data Is Used">
        <LegalList
          items={[
            <>
              <strong className="font-semibold text-ink">Session token / user info:</strong> Used solely to verify you are signed
              in to JobAgent and to display your account status in the extension popup. Stored
              only on your local device.
            </>,
            <>
              <strong className="font-semibold text-ink">LinkedIn cookie:</strong> Read once when you open the popup to confirm
              you are logged in to LinkedIn. The value is sent to the JobAgent server to enable
              automated Easy Apply — it is never stored permanently or shared with third parties.
            </>,
          ]}
        />
      </Section>

      <Section title="Data Sharing">
        <p>
          Data is only transmitted to <Code>jobagent.uk</Code> (the JobAgent service you are
          already using). No data is shared with LinkedIn or any other third party.
        </p>
      </Section>

      <Section title="Data Retention">
        <p>
          Data stored in <Code>chrome.storage.local</Code> remains on your device until you
          uninstall the extension or clear extension storage. You can clear it at any time
          via <Code>chrome://extensions</Code> → JobAgent → Storage.
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
