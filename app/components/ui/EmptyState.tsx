import { cn } from "@/lib/cn";

/**
 * Shown when a list has nothing in it. Say what would put something here and
 * offer that action — an empty screen is an invitation, not a dead end.
 */
export function EmptyState({
  icon,
  title,
  action,
  secondaryAction,
  className,
  children,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-card border border-dashed border-line-strong bg-surface px-6 py-10 text-center sm:py-14",
        className,
      )}
    >
      {icon && (
        <div aria-hidden="true" className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand-text">
          {icon}
        </div>
      )}
      <h2 className="text-title-card text-ink">{title}</h2>
      {children && <div className="mt-1.5 max-w-sm text-body-sm text-ink-muted">{children}</div>}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
