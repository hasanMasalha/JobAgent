import { cn } from "@/lib/cn";

/**
 * Classes for a selectable chip — a <button aria-pressed> in a set of
 * filters/options (search categories, locations, seniority).
 */
export function chipStyles({ selected, disabled }: { selected?: boolean; disabled?: boolean } = {}) {
  return cn(
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-body-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
    selected
      ? "border-brand bg-brand text-brand-on font-semibold"
      : disabled
      ? "cursor-not-allowed border-line bg-surface-sunken text-ink-subtle line-through decoration-ink-subtle/60"
      : "border-line-strong bg-surface text-ink hover:border-brand/60 hover:bg-brand-soft",
  );
}

/** A value the user added that they can remove again (keywords, filters). */
export function RemovableTag({
  label,
  onRemove,
  className,
}: {
  label: React.ReactNode;
  onRemove: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand-soft py-0.5 pl-2.5 pr-1 text-caption font-medium text-brand-text",
        className,
      )}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${typeof label === "string" ? label : "item"}`}
        className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg aria-hidden="true" viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  );
}
