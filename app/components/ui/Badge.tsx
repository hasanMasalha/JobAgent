import { cn } from "@/lib/cn";
import { statusMeta, type StatusTone } from "@/lib/application-status";

export type BadgeTone = StatusTone | "accent";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-ink-muted border-line",
  brand: "bg-brand-soft text-brand-text border-brand/20",
  accent: "bg-accent-soft text-accent-text border-accent/30",
  info: "bg-info-soft text-info-text border-info/25",
  progress: "bg-progress-soft text-progress-text border-progress/25",
  success: "bg-success-soft text-success-text border-success/25",
  waiting: "bg-waiting-soft text-waiting-text border-waiting/30",
  attention: "bg-attention-soft text-attention-text border-attention/30",
  danger: "bg-danger-soft text-danger-text border-danger/25",
};

const dots: Record<BadgeTone, string> = {
  neutral: "bg-ink-subtle",
  brand: "bg-brand",
  accent: "bg-accent",
  info: "bg-info",
  progress: "bg-progress",
  success: "bg-success",
  waiting: "bg-waiting",
  attention: "bg-attention",
  danger: "bg-danger",
};

export function badgeStyles({ tone = "neutral" }: { tone?: BadgeTone } = {}) {
  return cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-caption font-semibold",
    tones[tone],
  );
}

export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
}: {
  tone?: BadgeTone;
  /** Leading dot — use when the badge is a state rather than a label. */
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(badgeStyles({ tone }), className)}>
      {dot && <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", dots[tone])} />}
      {children}
    </span>
  );
}

/**
 * Application status, labelled and coloured from lib/application-status.ts.
 * Statuses that need the user to act get a filled dot so they stand out in a
 * list even without colour.
 */
export function StatusPill({ status, className }: { status: string; className?: string }) {
  const meta = statusMeta(status);
  return (
    <Badge tone={meta.tone} dot className={className}>
      {meta.needsAction && <span className="sr-only">Action required: </span>}
      {meta.label}
    </Badge>
  );
}

/** Pill classes for a <select> that shows the status (applications tracker). */
export function statusSelectStyles(status: string) {
  return cn(
    badgeStyles({ tone: statusMeta(status).tone }),
    "cursor-pointer py-1 pr-7 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50",
  );
}
