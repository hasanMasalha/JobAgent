import type { Metadata } from "next";
import Link from "next/link";
import { LegalHeader, Section, LegalList } from "../legal-ui";

export const metadata: Metadata = {
  title: "Terms of Service — JobAgent",
};

const LAST_UPDATED = "July 30, 2026";

export default function TermsOfServicePage() {
  return (
    <>
      <LegalHeader title="Terms of Service" lastUpdated={LAST_UPDATED} />

      <Section title="1. The Service">
        <p>
          JobAgent (&quot;we&quot;, &quot;us&quot;, &quot;the Service&quot;) is an AI-powered job application
          assistant. The Service scrapes job listings, matches them to your CV using vector-embedding
          similarity, and — only when you explicitly enable it — submits applications on your behalf to
          supported Applicant Tracking Systems (Greenhouse, Lever, Comeet, Ashby, and others) and LinkedIn
          Easy Apply listings.
        </p>
        <p>
          By creating an account or using the Service, you agree to these Terms of Service. If you do not
          agree, do not use the Service.
        </p>
      </Section>

      <Section title="2. Your Responsibilities">
        <p>As a user of JobAgent, you agree that you will:</p>
        <LegalList
          items={[
            "Provide accurate information in your CV, profile, and application preferences.",
            "Only upload documents and information you have the right to share.",
            "Use the Service to apply for roles you are genuinely interested in and qualified to be considered for.",
            "Not use the Service to spam employers, submit fraudulent applications, or circumvent an employer's or ATS provider's terms of use.",
            "Keep your account credentials secure and not share your account with others.",
          ]}
        />
      </Section>

      <Section title="3. Subscription Plans">
        <p>JobAgent is offered on three plans:</p>
        <LegalList
          items={[
            <>
              <strong>Free</strong> — limited daily AI job matches and a limited number of auto-applies per
              month, at no cost.
            </>,
            <>
              <strong>Pro</strong> — a paid monthly or annual subscription with a higher monthly auto-apply
              allowance, AI CV tailoring per application, and access to additional ATS platforms and the
              Chrome extension.
            </>,
            <>
              <strong>Unlimited</strong> — a paid monthly or annual subscription with unlimited auto-applies,
              priority matching, multiple CV versions, and an analytics dashboard.
            </>,
          ]}
        />
        <p>
          Paid subscriptions are billed in advance and renew automatically each billing period until
          cancelled. You can cancel at any time from your account settings; cancellation takes effect at
          the end of the current billing period. Payments are processed by our payment provider, Paddle. See
          our{" "}
          <Link href="/legal/refund" className="text-[#1a2e5e] dark:text-blue-400 underline">
            Refund Policy
          </Link>{" "}
          for details on refunds.
        </p>
      </Section>

      <Section title="4. Auto-Apply Disclaimer">
        <p>
          When you enable auto-apply, you are authorizing JobAgent to fill out and submit job application
          forms on your behalf using the CV, cover letter, and answers you have provided or approved. You
          remain responsible for the content and accuracy of every application submitted through your
          account, whether submitted automatically or after manual review.
        </p>
        <p>
          We take reasonable care to fill forms accurately, but automated form-filling can occasionally
          produce errors (mismatched fields, outdated information, or a failed submission). We are not
          liable for the consequences of an inaccurate or unsuccessful application submitted through the
          Service.
        </p>
      </Section>

      <Section title="5. No Guarantee of Employment or Interviews">
        <p>
          JobAgent helps you discover and apply to roles faster. We do not guarantee that any application
          will result in a response, an interview, or a job offer. Hiring decisions are made entirely by
          employers and are outside of our control.
        </p>
      </Section>

      <Section title="6. Account Termination">
        <p>
          You may delete your account at any time from your profile settings, which will stop future
          scraping, matching, and auto-apply activity and remove your personal data as described in our{" "}
          <Link href="/legal/privacy" className="text-[#1a2e5e] dark:text-blue-400 underline">
            Privacy Policy
          </Link>
          .
        </p>
        <p>
          We may suspend or terminate your account if you violate these Terms, misuse the Service, or use it
          in a way that we reasonably believe harms JobAgent, other users, or third parties (including
          employers and ATS providers).
        </p>
      </Section>

      <Section title="7. Governing Law">
        <p>
          These Terms are governed by the laws of the State of Israel, without regard to conflict-of-law
          principles. Any dispute arising from these Terms or your use of the Service will be subject to the
          exclusive jurisdiction of the competent courts of Israel.
        </p>
      </Section>

      <Section title="8. Contact">
        <p>
          Questions about these Terms? Email us at{" "}
          <a href="mailto:support@jobagent.uk" className="text-[#1a2e5e] dark:text-blue-400 underline">
            support@jobagent.uk
          </a>
          .
        </p>
      </Section>
    </>
  );
}
