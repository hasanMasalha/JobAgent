import Link from "next/link";

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
    <div style={{ minHeight: "100vh", background: "#f4f5f7", padding: "40px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ marginBottom: 32, display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="JobAgent" style={{ height: 48 }} />
        </div>

        <div style={{ background: "white", borderRadius: 12, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", padding: "40px 48px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: "#1a2e5e", marginBottom: 4 }}>Privacy Policy</h1>
          <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 40 }}>
            JobAgent Chrome Extension (version 1.1.1) — Last updated: 29 September 2026
          </p>

          <Section title="What the Extension Does">
            <p style={para}>
              The JobAgent Chrome Extension fills in LinkedIn Easy Apply forms for applications you
              start in JobAgent. This policy covers what the extension itself stores and sends. How
              JobAgent handles your account data is covered by our main{" "}
              <Link href="/legal/privacy" style={{ color: "#1a2e5e" }}>Privacy Policy</Link>.
            </p>
          </Section>

          <Section title="What Is Stored on Your Device">
            <p style={para}>
              The extension keeps the following in <Code>chrome.storage.local</Code>, on your device only:
            </p>
            <ul style={list}>
              <li>A sign-in token for JobAgent, so the extension can make requests for your account. It expires after 14 days and is renewed when you visit jobagent.uk.</li>
              <li>Your JobAgent user ID and email, to show your account in the popup and find your pending applications.</li>
              <li>The applications you queued from JobAgent and how far through them it is, so it can fill them one at a time.</li>
            </ul>
          </Section>

          <Section title="What Is Sent to JobAgent">
            <p style={para}>The extension sends data only to jobagent.uk:</p>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#f8f9fb" }}>
                  <Th>Data</Th>
                  <Th>When</Th>
                  <Th>Why</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>Your answers to application questions the extension doesn&apos;t recognise (the question and your answer)</Td>
                  <Td>When you answer such a question in an Easy Apply form</Td>
                  <Td>Saved to your JobAgent account and reused on later applications. You can see, edit or delete them in Profile → Saved answers.</Td>
                </tr>
                <tr style={{ background: "#f8f9fb" }}>
                  <Td>The outcome of an application (submitted, or needs you to finish it yourself) and the application&apos;s ID</Td>
                  <Td>When a form is submitted or stops</Td>
                  <Td>Updates your applications tracker in JobAgent.</Td>
                </tr>
                <tr>
                  <Td>Your JobAgent user ID</Td>
                  <Td>With the requests above</Td>
                  <Td>Identifies your account, alongside the sign-in token.</Td>
                </tr>
                <tr style={{ background: "#f8f9fb" }}>
                  <Td>Your LinkedIn <Code>li_at</Code> session cookie</Td>
                  <Td>When you open the popup while signed in to LinkedIn</Td>
                  <Td>The popup reads it to show whether you&apos;re signed in to LinkedIn. It is sent to jobagent.uk, which does not store it.</Td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Section title="What the Extension Receives from JobAgent">
            <p style={para}>
              To fill a form you started from JobAgent, the extension downloads, for that application
              only: the details you entered in Profile → Application details (name, phone, city,
              profile links, experience, education, notice period, expected salary and eligibility
              answers), the skills from your CV, your saved answers, and the cover letter for that job.
              It uses them to fill the form in your browser and does not keep them after the application.
            </p>
          </Section>

          <Section title="What the Extension Does Not Do">
            <ul style={list}>
              <li>It does not read your browsing history, or pages other than LinkedIn and jobagent.uk.</li>
              <li>It does not sell or share your data with third parties. Apart from the application you submit to an employer through LinkedIn, it sends data only to jobagent.uk.</li>
              <li>It does not use analytics or tracking services.</li>
            </ul>
          </Section>

          <Section title="Permissions">
            <ul style={list}>
              <li><strong>Access to linkedin.com and jobagent.uk:</strong> to fill Easy Apply forms on LinkedIn job pages, and to pick up your sign-in when you use jobagent.uk.</li>
              <li><strong>Cookies:</strong> to read your LinkedIn sign-in status for the popup.</li>
              <li><strong>Storage:</strong> for the data listed under &ldquo;What Is Stored on Your Device&rdquo;.</li>
              <li><strong>Notifications:</strong> to tell you when an application is submitted, needs you to finish it, or is paused.</li>
              <li><strong>Active tab and scripting:</strong> to fill in the form on the LinkedIn page you are applying on.</li>
            </ul>
          </Section>

          <Section title="Data Retention">
            <p style={para}>
              Data in <Code>chrome.storage.local</Code> stays on your device until you uninstall the
              extension or clear its storage via <Code>chrome://extensions</Code> → JobAgent → Storage;
              the sign-in token stops working after 14 days. Saved answers stay in your JobAgent account
              until you delete them in Profile → Saved answers.
            </p>
          </Section>

          <Section title="Contact" last>
            <p style={para}>
              For questions about this privacy policy, contact us at{" "}
              <a href="mailto:support@jobagent.uk" style={{ color: "#1a2e5e" }}>support@jobagent.uk</a>.
            </p>
          </Section>
        </div>

        <p style={{ textAlign: "center", fontSize: 12, color: "#9ca3af", marginTop: 24 }}>
          © 2026 JobAgent. All rights reserved.
        </p>
      </div>
    </div>
  );
}

const para: React.CSSProperties = { fontSize: 14, color: "#374151", lineHeight: 1.75, margin: 0 };
const list: React.CSSProperties = { paddingLeft: 20, margin: "8px 0 0", color: "#374151", fontSize: 14, lineHeight: 1.9 };

function Section({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ marginBottom: last ? 0 : 32 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1a2e5e", marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, color: "#374151", borderBottom: "1px solid #e5e7eb" }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: "10px 12px", color: "#374151", borderBottom: "1px solid #f3f4f6", verticalAlign: "top" }}>
      {children}
    </td>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ background: "#f3f4f6", padding: "1px 5px", borderRadius: 4, fontSize: 12, fontFamily: "monospace" }}>
      {children}
    </code>
  );
}
