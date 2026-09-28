import { cn } from "@/lib/cn";

const spinnerSizes = { sm: "h-3.5 w-3.5 border-[1.5px]", md: "h-5 w-5 border-2", lg: "h-8 w-8 border-2" };

export function Spinner({
  size = "md",
  label = "Loading",
  decorative,
  className,
}: {
  size?: keyof typeof spinnerSizes;
  label?: string;
  /** Inside a control that already announces its busy state (Button loading). */
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      role={decorative ? undefined : "status"}
      aria-hidden={decorative || undefined}
      className={cn("inline-flex shrink-0", className)}
    >
      <span
        className={cn(
          "rounded-full border-current border-r-transparent animate-spin motion-reduce:animate-none motion-reduce:border-r-current motion-reduce:opacity-60",
          spinnerSizes[size],
        )}
      />
      {!decorative && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Placeholder block for content that's loading. Size it with className. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-control bg-surface-sunken motion-safe:animate-pulse", className)}
    />
  );
}

/** Full-card loading placeholder, shaped like a job/application row. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 sm:p-5" aria-hidden="true">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <Skeleton className="h-8 w-12" />
      </div>
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-4/5" : "w-full")} />
        ))}
      </div>
    </div>
  );
}
