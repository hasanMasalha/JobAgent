import { cn } from "@/lib/cn";

/**
 * The deep navy band at the top of a key screen: big serif title, optional
 * tabs above it, meta on the right, and a toolbar underneath. It bleeds to
 * the edges of <main> and leaves room at the bottom for the first card to
 * overlap it (give that card a negative top margin, e.g. -mt-14 sm:-mt-16).
 * Navy in both themes, so everything inside uses the on-hero colours and
 * heroControlStyles.
 */
export function PageHero({
  topBar,
  tabs,
  title,
  subtitle,
  meta,
  children,
  bleed = true,
  className,
}: {
  /** Public pages: their site header, rendered full-width at the top of the band. */
  topBar?: React.ReactNode;
  tabs?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  children?: React.ReactNode;
  /** Dashboard pages sit inside <main>'s padding and bleed out of it; public pages don't. */
  bleed?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative isolate overflow-hidden bg-gradient-to-br from-hero-from via-hero-via to-hero-to",
        "px-gutter pb-20 text-on-hero sm:px-gutter-lg sm:pb-24",
        bleed ? "-mx-gutter -mt-6 pt-6 sm:-mx-gutter-lg sm:-mt-8 sm:pt-10" : "pt-0",
        className,
      )}
    >
      <Contours />
      {topBar && <div className="relative -mx-gutter mb-8 sm:-mx-gutter-lg sm:mb-12">{topBar}</div>}
      <div className="relative mx-auto max-w-6xl">
        {tabs}
        <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", tabs ? "mt-6 sm:mt-7" : undefined)}>
          <div className="min-w-0">
            <h1 className="text-balance font-serif text-display-sm text-on-hero sm:text-display">{title}</h1>
            {subtitle && <p className="mt-2.5 text-body text-on-hero-muted sm:text-[1.0625rem]">{subtitle}</p>}
          </div>
          {meta && <div className="flex shrink-0 items-center gap-3 sm:pb-1.5">{meta}</div>}
        </div>
        {children && <div className="mt-7 sm:mt-9">{children}</div>}
      </div>
    </section>
  );
}

/** Tabs that sit on the hero band — a quiet segmented pill. */
export function HeroTabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex max-w-full rounded-full border border-white/10 bg-white/[0.06] p-1"
    >
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn(
              "h-9 whitespace-nowrap rounded-full px-4 text-sm transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
              on ? "bg-on-hero font-semibold text-hero-from" : "text-on-hero-muted hover:text-on-hero",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Buttons, inputs and selects placed on the hero band. size "custom" leaves
 * out height/padding so the caller sets them without class conflicts.
 */
export function heroControlStyles({ size = "md" }: { size?: "md" | "sm" | "custom" } = {}) {
  return cn(
    "rounded-control border border-white/15 bg-white/[0.07] text-on-hero transition-colors duration-150",
    "hover:border-white/30 hover:bg-white/[0.11] disabled:cursor-not-allowed disabled:opacity-50",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
    "placeholder:text-on-hero-muted/80 [&>option]:bg-surface [&>option]:text-ink",
    size === "md" ? "h-10 px-3.5 text-sm" : size === "sm" ? "h-9 px-3 text-body-sm" : undefined,
  );
}

// Faint contour lines, top right — depth without decoration competing for
// attention.
function Contours() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full"
      preserveAspectRatio="xMaxYMin slice"
      viewBox="0 0 1280 420"
      fill="none"
    >
      <g stroke="white" strokeOpacity="0.045">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <ellipse key={i} cx="1060" cy="40" rx={70 + i * 90} ry={44 + i * 58} />
        ))}
      </g>
    </svg>
  );
}
