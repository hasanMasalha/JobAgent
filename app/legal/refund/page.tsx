import type { Metadata } from "next";
import { LegalHeader, Section, LegalList } from "../legal-ui";

export const metadata: Metadata = {
  title: "Refund Policy — JobAgent",
};

const LAST_UPDATED = "July 30, 2026";

export default function RefundPolicyPage() {
  return (
    <>
      <LegalHeader title="Refund Policy" lastUpdated={LAST_UPDATED} />

      <Section title="1. 7-Day Money-Back Guarantee">
        <p>
          If you&apos;re not satisfied with a Pro or Unlimited subscription, you can request a full refund
          within <strong>7 days</strong> of your initial purchase or of any renewal charge, no questions
          asked.
        </p>
      </Section>

      <Section title="2. How to Request a Refund">
        <p>
          Email{" "}
          <a href="mailto:support@jobagent.uk" className="text-[#1a2e5e] dark:text-blue-400 underline">
            support@jobagent.uk
          </a>{" "}
          from the address on your account with your request. Please include:
        </p>
        <LegalList
          items={[
            "The email address associated with your JobAgent account.",
            "Your plan (Pro or Unlimited) and whether you're billed monthly or annually.",
            "The reason for your refund request (optional, but it helps us improve).",
          ]}
        />
      </Section>

      <Section title="3. Processing Time">
        <p>
          Approved refunds are processed by our payment provider, Paddle, within{" "}
          <strong>5–10 business days</strong> of approval. The funds will appear back on the payment method
          used for the original purchase; exact timing after that can depend on your bank or card issuer.
        </p>
      </Section>

      <Section title="4. After 7 Days">
        <p>
          We do not offer refunds for requests made more than 7 days after the relevant purchase or renewal
          charge. You can still cancel your subscription at any time — cancellation stops future billing but
          does not itself trigger a refund for the current billing period.
        </p>
      </Section>

      <Section title="5. Annual Plans Cancelled Mid-Year">
        <p>
          If you cancel an annual Pro or Unlimited subscription outside the 7-day window, we&apos;ll issue a{" "}
          <strong>prorated refund</strong> for the unused portion of your annual term, calculated from the
          date we receive your cancellation request. Prorated refunds follow the same 5–10 business day
          processing time as above.
        </p>
      </Section>

      <Section title="6. Contact">
        <p>
          Any questions about billing or refunds — reach us at{" "}
          <a href="mailto:support@jobagent.uk" className="text-[#1a2e5e] dark:text-blue-400 underline">
            support@jobagent.uk
          </a>
          .
        </p>
      </Section>
    </>
  );
}
