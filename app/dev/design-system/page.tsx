import { notFound } from "next/navigation";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { APPLICATION_STATUS } from "@/lib/application-status";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  MatchScore,
  Meter,
  Notice,
  PageHeader,
  Select,
  SkeletonCard,
  Spinner,
  StatusPill,
  Textarea,
  buttonStyles,
  noticeLinkStyles,
  statusSelectStyles,
} from "@/app/components/ui";

// Design-system reference. Development only — 404s in production builds.

const SWATCHES: Array<{ name: string; cls: string; note: string }> = [
  { name: "canvas", cls: "bg-canvas", note: "Page background" },
  { name: "surface", cls: "bg-surface", note: "Cards, inputs" },
  { name: "surface-sunken", cls: "bg-surface-sunken", note: "Wells, skeletons" },
  { name: "line", cls: "bg-line", note: "Borders" },
  { name: "ink", cls: "bg-ink", note: "Body text" },
  { name: "ink-muted", cls: "bg-ink-muted", note: "Secondary text" },
  { name: "brand", cls: "bg-brand", note: "Primary actions — CV navy" },
  { name: "brand-soft", cls: "bg-brand-soft", note: "Selected, current" },
  { name: "accent", cls: "bg-accent", note: "Brass — one use per screen" },
];

const TONES = ["info", "progress", "success", "waiting", "attention", "danger"] as const;
const TONE_SWATCH: Record<(typeof TONES)[number], string> = {
  info: "bg-info",
  progress: "bg-progress",
  success: "bg-success",
  waiting: "bg-waiting",
  attention: "bg-attention",
  danger: "bg-danger",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-8">
      <h2 className="mb-5 text-title-section text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="min-h-screen bg-canvas font-sans text-ink">
      <div className="mx-auto max-w-5xl space-y-section px-gutter py-8 sm:px-gutter-lg sm:py-12">
        <PageHeader
          title="JobAgent design system"
          description="Tokens and shared components. Toggle the theme and resize to 375px to check every state."
          actions={<ThemeToggle />}
        />

        <Section title="Colour">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SWATCHES.map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <div className={`h-10 w-10 shrink-0 rounded-control border border-line ${s.cls}`} />
                <div className="min-w-0">
                  <p className="text-body-sm font-semibold">{s.name}</p>
                  <p className="truncate text-caption text-ink-subtle">{s.note}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {TONES.map((t) => (
              <span key={t} className="inline-flex items-center gap-2 text-body-sm text-ink-muted">
                <span className={`h-3 w-3 rounded-full ${TONE_SWATCH[t]}`} />
                {t}
              </span>
            ))}
          </div>
        </Section>

        <Section title="Type">
          <div className="space-y-4">
            <p className="font-serif text-title-page">Page title — Source Serif 4, 28/34</p>
            <p className="text-title-section">Section title — Public Sans semibold, 18/26</p>
            <p className="text-title-card">Card title — Public Sans semibold, 16/22</p>
            <p className="max-w-prose text-body text-ink-muted">
              Body, 15/24. Used for descriptions and anything meant to be read rather than scanned. Line length stays
              under about 75 characters.
            </p>
            <p className="text-sm">Interface text, 14/20 — table cells, buttons, form values.</p>
            <p className="text-body-sm text-ink-muted">Small, 13/20 — meta lines, helper text.</p>
            <p className="text-caption text-ink-subtle">Caption, 12/16 — timestamps, counts.</p>
            <p className="numerals font-serif text-figure">$24.99</p>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Tailor CV &amp; apply</Button>
              <Button variant="secondary">Save job</Button>
              <Button variant="ghost">Dismiss</Button>
              <Button variant="danger">Cancel application</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="attention" size="sm">Apply manually</Button>
              <Button variant="waiting" size="sm">Verify email</Button>
              <a href="#" className={buttonStyles({ variant: "secondary", size: "sm" })}>View job</a>
              <Button size="sm" loading disabled>Applying</Button>
              <Button size="sm" disabled>Disabled</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg">Large</Button>
              <Button>Medium</Button>
              <Button size="sm">Small</Button>
            </div>
          </div>
        </Section>

        <Section title="Pricing plan states">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card padding="lg" className="flex flex-col">
              <h3 className="text-title-card">Free</h3>
              <p className="numerals mt-4 font-serif text-figure">$0</p>
              <div className="mt-6">
                <Button variant="secondary" block disabled>Downgrade</Button>
              </div>
            </Card>
            <Card tone="featured" padding="lg" className="relative flex flex-col">
              <Badge tone="accent" className="absolute -top-3 left-5">Most popular</Badge>
              <h3 className="text-title-card">Pro</h3>
              <p className="numerals mt-4 font-serif text-figure">
                $24.99<span className="font-sans text-sm font-normal text-ink-subtle"> /month</span>
              </p>
              <div className="mt-6">
                <Button variant="current" block disabled>Current plan</Button>
              </div>
            </Card>
            <Card padding="lg" className="flex flex-col">
              <h3 className="text-title-card">Unlimited</h3>
              <p className="numerals mt-4 font-serif text-figure">$69.99</p>
              <div className="mt-6">
                <Button block>Upgrade</Button>
              </div>
            </Card>
          </div>
          <p className="mt-3 text-caption text-ink-subtle">
            Upgrade → primary. Downgrade → secondary. Current plan → &ldquo;current&rdquo;: disabled but stays legible.
            Working… → loading spinner.
          </p>
        </Section>

        <Section title="Application statuses">
          <div className="flex flex-wrap gap-2">
            {Object.keys(APPLICATION_STATUS).map((s) => (
              <StatusPill key={s} status={s} />
            ))}
            <StatusPill status="some_future_status" />
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <select aria-label="Status" defaultValue="interviewing" className={statusSelectStyles("interviewing")}>
              <option value="applied">Applied</option>
              <option value="interviewing">Interviewing</option>
              <option value="offer">Offer</option>
              <option value="rejected">Rejected</option>
            </select>
            <span className="text-caption text-ink-subtle">Editable status on the tracker (a native select).</span>
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap gap-2">
            <Badge>Remote</Badge>
            <Badge tone="brand">Greenhouse</Badge>
            <Badge tone="success">Save 20%</Badge>
            <Badge tone="info">Easy Apply</Badge>
            <Badge tone="accent">Most popular</Badge>
          </div>
        </Section>

        <Section title="Match score">
          <div className="flex items-end gap-8">
            <MatchScore score={91} />
            <MatchScore score={72} />
            <MatchScore score={48} />
          </div>
        </Section>

        <Section title="Cards">
          <div className="grid gap-4 md:grid-cols-2">
            <Card as="article">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate text-title-card">Senior Frontend Engineer</h3>
                  <p className="text-body-sm text-ink-muted">Wix, Tel Aviv (hybrid)</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone="brand">Greenhouse</Badge>
                    <Badge>Posted 2 days ago</Badge>
                  </div>
                </div>
                <MatchScore score={86} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm">Apply</Button>
                <Button size="sm" variant="secondary">Tailor CV &amp; apply</Button>
                <Button size="sm" variant="ghost">Save</Button>
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Pro plan"
                description="Resets on 1 October"
                action={<a href="#" className="text-body-sm font-semibold text-brand-text hover:underline">Upgrade</a>}
              />
              <div className="space-y-4">
                <Meter label="Auto-applies this month" used={31} limit={100} />
                <Meter label="CV tailoring this month" used={86} limit={100} />
                <Meter label="Matches today" used={10} limit={10}>
                  <span className="text-danger-text">
                    You&apos;ve reached this limit.{" "}
                    <a href="#" className="font-semibold underline underline-offset-2">Upgrade your plan</a>
                  </span>
                </Meter>
                <Meter label="Auto-applies" used={412} limit={null} />
              </div>
            </Card>
          </div>
        </Section>

        <Section title="Notices">
          <div className="-mx-gutter space-y-0 sm:-mx-gutter-lg">
            <Notice
              tone="waiting"
              layout="bar"
              action={<a href="#" className={noticeLinkStyles()}>Update your CV</a>}
            >
              We upgraded how CV files are handled — please re-upload your CV or regenerate it to keep auto-applying.
            </Notice>
          </div>
          <div className="mt-4 space-y-3">
            <Notice tone="waiting">
              Check your email for a verification code from Greenhouse to complete this application.
            </Notice>
            <Notice tone="attention">
              We couldn&apos;t complete this application automatically — check your email for the link to apply yourself.
            </Notice>
            <Notice
              tone="danger"
              title="You've reached your monthly auto-apply limit"
              action={<a href="#" className={buttonStyles({ size: "sm" })}>Upgrade to Pro</a>}
            >
              Upgrade to Pro for 100 auto-applies a month.
            </Notice>
            <Notice tone="success">Your plan is updated.</Notice>
            <Notice tone="info">The browser extension handles LinkedIn listings without a direct application link.</Notice>
          </div>
        </Section>

        <Section title="Form controls">
          <Card className="max-w-md space-y-4">
            <Field id="ds-email" label="Email">
              <Input type="email" placeholder="you@example.com" />
            </Field>
            <Field id="ds-title" label="Job titles" hint="Separate titles with commas.">
              <Input defaultValue="Frontend Engineer, UI Engineer" />
            </Field>
            <Field id="ds-salary" label="Minimum salary" error="Enter a number, like 25000." optional>
              <Input defaultValue="25k" />
            </Field>
            <Field id="ds-remote" label="Work type">
              <Select defaultValue="hybrid">
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
              </Select>
            </Field>
            <Field id="ds-cover" label="Cover letter">
              <Textarea rows={3} defaultValue="Dear hiring team," />
            </Field>
            <Checkbox label="Remember me" />
            <Input disabled placeholder="Disabled" aria-label="Disabled example" />
          </Card>
        </Section>

        <Section title="Empty states">
          <EmptyState
            icon={
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-5 w-5">
                <rect x="3.5" y="3" width="13" height="14" rx="2" />
                <path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" strokeLinecap="round" />
              </svg>
            }
            title="No applications yet"
            action={<a href="#" className={buttonStyles()}>Browse your matches</a>}
          >
            Applications you send from JobAgent show up here with their status.
          </EmptyState>
        </Section>

        <Section title="Loading">
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-brand-text">
              <Spinner size="sm" />
              <Spinner />
              <Spinner size="lg" label="Loading matches" />
            </div>
            <SkeletonCard />
            <SkeletonCard lines={1} />
          </div>
        </Section>
      </div>
    </div>
  );
}
