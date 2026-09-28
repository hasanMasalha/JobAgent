import { cn } from "@/lib/cn";

export type NoticeTone = "info" | "success" | "waiting" | "attention" | "danger" | "brand";

const tones: Record<NoticeTone, { box: string; icon: string }> = {
  info: { box: "bg-info-soft border-info/25 text-info-text", icon: "text-info" },
  success: { box: "bg-success-soft border-success/25 text-success-text", icon: "text-success" },
  waiting: { box: "bg-waiting-soft border-waiting/30 text-waiting-text", icon: "text-waiting" },
  attention: { box: "bg-attention-soft border-attention/30 text-attention-text", icon: "text-attention" },
  danger: { box: "bg-danger-soft border-danger/25 text-danger-text", icon: "text-danger" },
  brand: { box: "bg-brand-soft border-brand/20 text-brand-text", icon: "text-brand-text" },
};

/**
 * A message about the state of something — CV re-upload, usage limits,
 * per-application guidance.
 *
 * layout="bar"    full-width strip under the nav (no radius, bottom border)
 * layout="inline" rounded box inside page content
 */
export function Notice({
  tone = "info",
  layout = "inline",
  title,
  action,
  className,
  children,
}: {
  tone?: NoticeTone;
  layout?: "bar" | "inline";
  title?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const t = tones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        t.box,
        layout === "bar" ? "border-b px-gutter py-2.5 sm:px-gutter-lg" : "rounded-card border px-3.5 py-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 text-body-sm">
        <ToneIcon tone={tone} className={cn("mt-0.5 h-4 w-4 shrink-0", t.icon)} />
        <div className="min-w-0 flex-1 basis-56">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(Boolean(title) && "mt-0.5")}>{children}</div>}
        </div>
        {action && <div className="shrink-0 pl-7 sm:pl-0">{action}</div>}
      </div>
    </div>
  );
}

/** Text link styled for use inside a Notice (inherits the tone colour). */
export function noticeLinkStyles() {
  return "font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";
}

function ToneIcon({ tone, className }: { tone: NoticeTone; className: string }) {
  const common = { "aria-hidden": true, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, className } as const;
  if (tone === "success") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M5.25 8.25l1.75 1.75 3.75-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === "waiting") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M8 4.75V8l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === "attention" || tone === "danger") {
    return (
      <svg {...common}>
        <path d="M8 1.9l6.4 11.2H1.6L8 1.9z" strokeLinejoin="round" />
        <path d="M8 6.5v2.75" strokeLinecap="round" />
        <circle cx="8" cy="11.1" r="0.4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.5" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.4" fill="currentColor" />
    </svg>
  );
}
