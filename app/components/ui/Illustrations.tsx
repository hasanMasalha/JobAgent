// Fine-line illustrations for whole-screen states. Navy and neutral lines
// only — no brass, which is reserved for meaning. Sized for StatePanel.

const line = "stroke-line-strong";
const soft = "stroke-line";
const ink = "stroke-brand";

/** Error: a folded map whose route breaks off. */
export function BrokenRouteIllustration() {
  return (
    <svg aria-hidden="true" width="180" height="120" viewBox="0 0 180 120" fill="none" strokeWidth={1.5}>
      <path d="M20 24l42-14 56 14 42-14v86l-42 14-56-14-42 14z" className={line} strokeLinejoin="round" />
      <path d="M62 10v86M118 24v86" className={soft} />
      <path d="M36 80c14-8 22-26 38-28s22 10 34 4" className={ink} strokeWidth={2} strokeLinecap="round" strokeDasharray="1 7" />
      <path d="M128 46c6-4 12-10 20-12" className={ink} strokeWidth={2} strokeLinecap="round" strokeDasharray="1 7" />
      <circle cx="36" cy="80" r="4" className="fill-brand" stroke="none" />
      <circle cx="118" cy="54" r="11" className="fill-waiting-soft stroke-waiting" />
      <path d="M118 48v7M118 59v.5" className="stroke-waiting-text" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

/** No matches today: the sun coming up — check back tomorrow. */
export function HorizonIllustration() {
  return (
    <svg aria-hidden="true" width="220" height="110" viewBox="0 0 220 110" fill="none" strokeWidth={1.5} strokeLinecap="round">
      <path d="M10 84h200" className={line} />
      <path d="M60 84a50 50 0 0 1 100 0" className={ink} />
      <path d="M78 84a32 32 0 0 1 64 0" className={soft} />
      <path d="M110 22v-12M66 40l-8-8M154 40l8-8M44 70h-12M188 70h-12" className={line} />
      <path d="M40 96h40M140 96h40M92 104h36" className={soft} />
    </svg>
  );
}

/** No filter results: a funnel holding everything back. */
export function FunnelIllustration() {
  return (
    <svg aria-hidden="true" width="160" height="112" viewBox="0 0 160 112" fill="none" strokeWidth={1.5} strokeLinecap="round">
      <path d="M20 16h120l-46 48v30l-28 12V64z" className={ink} strokeLinejoin="round" />
      <path d="M36 32h88" className={soft} />
      <circle cx="52" cy="6" r="3" className="fill-line-strong" stroke="none" />
      <circle cx="80" cy="8" r="3" className="fill-line-strong" stroke="none" />
      <circle cx="104" cy="5" r="3" className="fill-line-strong" stroke="none" />
      <path d="M4 106h30M126 106h30" className={soft} />
    </svg>
  );
}

/** Locked feature: a stack of listings behind a lock. */
export function LockedStackIllustration() {
  return (
    <svg aria-hidden="true" width="96" height="80" viewBox="0 0 96 80" fill="none" strokeWidth={1.5} strokeLinecap="round">
      <rect x="8" y="14" width="44" height="56" rx="5" className={soft} />
      <rect x="18" y="6" width="44" height="56" rx="5" className={`${line} fill-surface-raised`} />
      <path d="M27 20h26M27 28h26M27 36h16" className={soft} />
      <rect x="52" y="42" width="32" height="26" rx="5" className="fill-brand" stroke="none" />
      <path d="M60 42v-6a8 8 0 0 1 16 0v6" className={ink} strokeWidth={2} />
      <circle cx="68" cy="54" r="3" className="fill-surface-raised" stroke="none" />
    </svg>
  );
}

/** Browse search found nothing: a lens over an empty page. */
export function EmptySearchIllustration() {
  return (
    <svg aria-hidden="true" width="140" height="104" viewBox="0 0 140 104" fill="none" strokeWidth={1.5} strokeLinecap="round">
      <rect x="18" y="8" width="70" height="88" rx="6" className={line} />
      <path d="M30 26h46M30 36h30" className={soft} />
      <circle cx="88" cy="60" r="20" className={`${ink} fill-surface-raised`} />
      <path d="M103 75l18 18" className={ink} strokeWidth={2.5} />
    </svg>
  );
}
