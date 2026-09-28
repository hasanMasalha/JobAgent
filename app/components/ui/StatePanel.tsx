import { cn } from "@/lib/cn";

/**
 * A whole-screen state — loading failed, nothing here yet, locked — shown in
 * the featured card's place so the screen keeps its shape. Serif title, one
 * line of plain explanation, at most one action.
 */
export function StatePanel({
  illustration,
  title,
  children,
  action,
  role,
  className,
}: {
  illustration?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  role?: "alert" | "status";
  className?: string;
}) {
  return (
    <section
      role={role}
      className={cn(
        "flex flex-col items-center rounded-[1.375rem] bg-surface-raised px-6 py-12 text-center shadow-dossier ring-1 ring-line/60",
        "motion-safe:animate-lift-in sm:px-12 sm:py-16",
        className,
      )}
    >
      {illustration && <div className="mb-7 text-brand">{illustration}</div>}
      <h2 className="text-balance font-serif text-feature-sm text-ink sm:text-feature">{title}</h2>
      {children && <div className="mt-3 max-w-lg text-body text-ink-muted sm:text-[1.0625rem] sm:leading-7">{children}</div>}
      {action && <div className="mt-7">{action}</div>}
    </section>
  );
}
