import { Badge, ScoreRing, DirectIcon, FitMark, GapMark } from "@/app/components/ui";

/**
 * A static picture of the Matches screen's featured card, for the landing
 * page — shows at a glance that JobAgent is an app you use, not a service.
 * Decorative markup (no real controls), described once for screen readers.
 */
export function ProductPreview() {
  return (
    <figure className="m-0">
      <div
        role="img"
        aria-label="Example from the JobAgent app: a matched job with a 92% match score, the reasons it fits your CV, one gap, and an Apply button."
        className="grid gap-6 rounded-[1.375rem] bg-surface-raised p-5 shadow-dossier ring-1 ring-line/60 motion-safe:animate-lift-in sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-8 sm:p-8"
      >
        <div aria-hidden="true" className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Top match</Badge>
            <Badge tone="success"><DirectIcon className="h-3.5 w-3.5" />Direct Apply</Badge>
            <span className="text-body-sm text-ink-subtle">2h ago</span>
          </div>
          <p className="mt-4 font-serif text-feature-sm text-ink sm:text-[2rem] sm:leading-tight">Senior Product Designer</p>
          <p className="mt-1.5 text-body text-ink-muted"><span className="font-semibold text-ink">Northwind</span> · Remote</p>
          <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div>
              <p className="mb-2 text-caption font-semibold text-success-text">Why it fits</p>
              <ul className="space-y-1.5 text-body-sm text-ink">
                <li className="flex gap-2.5"><FitMark className="mt-0.5" />6 years in product design, as the role asks</li>
                <li className="flex gap-2.5"><FitMark className="mt-0.5" />Led a design system, named in the posting</li>
              </ul>
            </div>
            <div>
              <p className="mb-2 text-caption font-semibold text-attention-text">Gaps</p>
              <p className="flex gap-2.5 text-body-sm text-ink"><GapMark className="mt-0.5" />No fintech experience listed</p>
            </div>
          </div>
        </div>
        <div aria-hidden="true" className="flex items-center gap-4 sm:flex-col sm:items-stretch sm:gap-3">
          <ScoreRing score={92} size="md" className="sm:self-center" />
          <div className="flex flex-1 flex-col gap-2">
            <span className="inline-flex h-10 items-center justify-center rounded-control bg-accent text-sm font-semibold text-accent-on">Apply</span>
            <span className="inline-flex h-10 items-center justify-center rounded-control border border-line-strong bg-surface text-sm font-semibold text-ink">Tailor CV</span>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-caption text-ink-subtle">Example from the app. Every match comes with the reasons behind it.</figcaption>
    </figure>
  );
}
