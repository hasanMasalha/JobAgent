import { cn } from "@/lib/cn";

/**
 * How well a job fits the user's CV — the product's headline number, so it
 * gets the serif figure and the brass accent when it's a strong match.
 * Thresholds match the existing JobCard (80 / 60).
 */
export function MatchScore({ score, className }: { score: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = clamped >= 80 ? "strong" : clamped >= 60 ? "good" : "weak";
  const styles = {
    strong: { text: "text-accent-text", bar: "bg-accent", word: "Strong match" },
    good: { text: "text-brand-text", bar: "bg-brand", word: "Good match" },
    weak: { text: "text-ink-subtle", bar: "bg-ink-subtle/60", word: "Partial match" },
  }[band];

  return (
    <div className={cn("flex w-14 shrink-0 flex-col items-end", className)} title={`${styles.word}: ${clamped}%`}>
      <span className="sr-only">{`${styles.word}, ${clamped} percent`}</span>
      <span aria-hidden="true" className={cn("numerals font-serif text-[1.625rem] font-semibold leading-none", styles.text)}>
        {clamped}
        <span className="ml-px align-top font-sans text-caption font-semibold">%</span>
      </span>
      <span aria-hidden="true" className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-surface-sunken">
        <span className={cn("block h-full rounded-full", styles.bar)} style={{ width: `${clamped}%` }} />
      </span>
    </div>
  );
}
