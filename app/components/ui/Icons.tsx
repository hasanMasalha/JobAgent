import { cn } from "@/lib/cn";

// One stroke icon set for the app: 16px grid, 1.5 stroke, round caps, drawn
// in currentColor. Decorative by default — the text beside them carries the
// meaning, so they're aria-hidden.

type IconProps = { className?: string };

function Svg({ className, children, fill = "none" }: IconProps & { children: React.ReactNode; fill?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill={fill}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
    >
      {children}
    </svg>
  );
}

/** Straight to the company's ATS: an arrow that lands on a wall. */
export const DirectIcon = (p: IconProps) => <Svg {...p}><path d="M2.5 8h8M8 5l3 3-3 3M13.5 3v10" /></Svg>;
/** Browser extension: a plug. */
export const ExtensionIcon = (p: IconProps) => <Svg {...p}><path d="M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0V5zM8 12v2" /></Svg>;
/** Sent for you by email: a paper plane. */
export const AutoIcon = (p: IconProps) => <Svg {...p}><path d="M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5L14 2z" /></Svg>;
/** Leaves JobAgent for the company's own site. */
export const ExternalIcon = (p: IconProps) => <Svg {...p}><path d="M9 3h4v4M13 3L7 9M11 9.5V13H3V5h3.5" /></Svg>;

export const RefreshIcon = (p: IconProps) => <Svg {...p}><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" /></Svg>;
export const ArrowRightIcon = (p: IconProps) => <Svg {...p}><path d="M3 8h10M9 4l4 4-4 4" /></Svg>;
export const PenIcon = (p: IconProps) => <Svg {...p}><path d="M3 13l2.5-.5L13 5l-2-2-7.5 7.5z" /></Svg>;
export const FilterIcon = (p: IconProps) => <Svg {...p}><path d="M2 4h12M4 8h8M6 12h4" /></Svg>;
export const ChevronDownIcon = (p: IconProps) => <Svg {...p}><path d="M4 6l4 4 4-4" /></Svg>;
export const CloseIcon = (p: IconProps) => <Svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></Svg>;
export const SearchIcon = (p: IconProps) => <Svg {...p}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></Svg>;
export const UploadIcon = (p: IconProps) => <Svg {...p}><path d="M8 10V2.5M5 5.5l3-3 3 3M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" /></Svg>;
export const DocumentIcon = (p: IconProps) => <Svg {...p}><path d="M4 1.5h5.5L12.5 4.5V14a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z" /><path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5" /></Svg>;
export const CheckIcon = (p: IconProps) => <Svg {...p}><path d="M3.5 8.5l3 3 6-7" /></Svg>;
/** An app window — "software", as opposed to a service. */
export const AppWindowIcon = (p: IconProps) => <Svg {...p}><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6h12M4.5 4.5h.01M6.5 4.5h.01" /></Svg>;
export const CalendarIcon = (p: IconProps) => <Svg {...p}><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 7h11M5.5 2v3M10.5 2v3" /></Svg>;
export const SwapIcon = (p: IconProps) => <Svg {...p}><path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" /></Svg>;
export const DoorOpenIcon = (p: IconProps) => <Svg {...p}><path d="M3 14h10M4.5 14V2.5h7V14M9 8.5v.01" /></Svg>;
export const BookmarkIcon =({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? "currentColor" : "none"}><path d="M4 2.5h8v11l-4-3-4 3z" /></Svg>
);

/** "Why it fits" bullet. */
export function FitMark({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={cn("h-4 w-4 shrink-0", className)}>
      <circle cx="8" cy="8" r="7" className="fill-success-soft stroke-success/40" strokeWidth={1} />
      <path d="M5 8.2l2 2 4-4.2" fill="none" className="stroke-success-text" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "Gaps" bullet. */
export function GapMark({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={cn("h-4 w-4 shrink-0", className)}>
      <circle cx="8" cy="8" r="7" className="fill-attention-soft stroke-attention/40" strokeWidth={1} />
      <path d="M8 4.8v3.8M8 11v.2" fill="none" className="stroke-attention-text" strokeWidth={1.7} strokeLinecap="round" />
    </svg>
  );
}
