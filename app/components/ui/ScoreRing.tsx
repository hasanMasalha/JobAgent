import { cn } from "@/lib/cn";

const R = 54;
const C = 2 * Math.PI * R;

const WORDS = {
  match: { strong: "Strong match", good: "Good match", weak: "Partial match", caption: "match", unit: "%", sr: "percent" },
  cv: { strong: "Strong CV", good: "Good CV", weak: "Needs work", caption: "out of 100", unit: "", sr: "out of 100" },
};

/**
 * A 0–100 score as a ring: the featured job's match score, or (kind="cv")
 * the CV score on My CV. Brass only for 80+, same thresholds as MatchScore —
 * brass has to mean something.
 */
export function ScoreRing({
  score,
  size = "lg",
  kind = "match",
  className,
}: {
  score: number;
  size?: "md" | "lg";
  kind?: "match" | "cv";
  className?: string;
}) {
  const w = WORDS[kind];
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = clamped >= 80 ? "strong" : clamped >= 60 ? "good" : "weak";
  const s = {
    strong: { track: "stroke-accent-soft", arc: "stroke-accent", word: w.strong, wordCls: "text-accent-text" },
    good: { track: "stroke-brand-soft", arc: "stroke-brand", word: w.good, wordCls: "text-brand-text" },
    weak: { track: "stroke-surface-sunken", arc: "stroke-ink-subtle", word: w.weak, wordCls: "text-ink-subtle" },
  }[band];
  const offset = C * (1 - clamped / 100);

  return (
    <div className={cn("relative shrink-0", size === "lg" ? "h-36 w-36" : "h-[6.5rem] w-[6.5rem]", className)}>
      <span className="sr-only">{`${s.word}, ${clamped} ${w.sr}`}</span>
      <svg aria-hidden="true" viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth={8} className={s.track} />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          style={{ "--ring-c": C } as React.CSSProperties}
          className={cn(s.arc, "motion-safe:animate-ring-draw")}
        />
      </svg>
      <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("numerals font-serif font-medium leading-none text-ink", size === "lg" ? "text-[2.875rem]" : "text-[2rem]")}>
          {clamped}
          {w.unit && <span className={cn("align-top", size === "lg" ? "text-xl" : "text-sm")}>{w.unit}</span>}
        </span>
        <span className={cn("mt-1 text-caption font-semibold", s.wordCls)}>{w.caption}</span>
      </div>
    </div>
  );
}
