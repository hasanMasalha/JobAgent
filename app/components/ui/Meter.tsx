import { cn } from "@/lib/cn";

/**
 * Usage against a plan limit. Brand colour while there's room; turns
 * "waiting" (amber) from 80% and "danger" only once the limit is reached —
 * using most of what you paid for isn't an error.
 */
export function Meter({
  label,
  used,
  limit,
  className,
  children,
}: {
  label: string;
  used: number;
  /** null = unlimited */
  limit: number | null;
  className?: string;
  /** Rendered under the bar, e.g. the "limit reached" message. */
  children?: React.ReactNode;
}) {
  if (limit === null) {
    return (
      <div className={cn("flex items-baseline justify-between gap-4 text-body-sm", className)}>
        <span className="text-ink-muted">{label}</span>
        <span className="numerals font-semibold text-ink">
          {used} <span className="font-normal text-ink-subtle">(unlimited)</span>
        </span>
      </div>
    );
  }

  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const bar = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-waiting" : "bg-brand";

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-4 text-body-sm">
        <span className="text-ink-muted">{label}</span>
        <span className="numerals font-semibold text-ink">
          {used}
          <span className="font-normal text-ink-subtle"> of {limit}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300", bar)} style={{ width: `${pct}%` }} />
      </div>
      {children && <div className="mt-2 text-caption">{children}</div>}
    </div>
  );
}
