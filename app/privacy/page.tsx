export const metadata = {
  title: "Privacy Policy — JobAgent",
  description: "JobAgent Chrome Extension privacy policy",
};

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", padding: "40px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 32, display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="JobAgent" style={{ height: 48 }} />
        </div>

        <div
          style={{
            background: "white",
            borderRadius: 12,
            boxShadow: "0 2px 16px rgba(0,0,0,0.07)",
            padding: "40px 48px",
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 600, color: "#1a2e5e", marginBottom: 4 }}>
            Privacy Policy
          </h1>
          <p style={{ fontSize: 13, color: "#9ca3af", marginBottom: 40 }}>
            JobAgent Chrome Extension — Last updated: May 2026
          </p>

          <Section title="What We Collect">
            <p style={para}>
              The JobAgent Chrome Extension collects and stores the following data:
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#f8f9fb" }}>
                  <Th>Data</Th>
                  <Th>Purpose</Th>
                  <Th>Storage</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>JobAgent session token</Td>
                  <Td>Authenticate API requests</Td>
                  <Td><Code>chrome.storage.local</Code> (local device only)</Td>
                </tr>
                <tr style={{ background: "#f8f9fb" }}>
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
          </Section>

          <Section title="What We Do Not Collect">
            <ul style={{ paddingLeft: 20, margin: 0, color: "#374151", fontSize: 14, lineHeight: 2 }}>
              <li>We do not collect browsing history</li>
              <li>We do not collect personal data beyond your JobAgent account email</li>
              <li>We do not sell or share any data with third parties</li>
              <li>We do not use analytics or tracking services</li>
            </ul>
          </Section>

          <Section title="How Data Is Used">
            <ul style={{ paddingLeft: 20, margin: 0, color: "#374151", fontSize: 14, lineHeight: 2 }}>
              <li>
                <strong>Session token / user info:</strong> Used solely to verify you are signed
                in to JobAgent and to display your account status in the extension popup. Stored
                only on your local device.
              </li>
              <li>
                <strong>LinkedIn cookie:</strong> Read once when you open the popup to confirm
                you are logged in to LinkedIn. The value is sent to the JobAgent server to enable
                automated Easy Apply — it is never stored permanently or shared with third parties.
              </li>
            </ul>
          </Section>

          <Section title="Data Sharing">
            <p style={para}>
              Data is only transmitted to <Code>jobagent.uk</Code> (the JobAgent service you are
              already using). No data is shared with LinkedIn or any other third party.
            </p>
          </Section>

          <Section title="Data Retention">
            <p style={para}>
              Data stored in <Code>chrome.storage.local</Code> remains on your device until you
              uninstall the extension or clear extension storage. You can clear it at any time
              via <Code>chrome://extensions</Code> → JobAgent → Storage.
            </p>
          </Section>

          <Section title="Contact" last>
            <p style={para}>
              For questions about this privacy policy, contact us at{" "}
              <a href="mailto:support@jobagent.uk" style={{ color: "#1a2e5e" }}>
                support@jobagent.uk
              </a>.
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

function Section({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ marginBottom: last ? 0 : 32 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1a2e5e", marginBottom: 12 }}>
        {title}
      </h2>
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
