// Single source of truth for how an application status is presented.
// Presentation only — which statuses exist and when they're written is
// owned by the apply flow (see CLAUDE.md "Apply flow rules").

export type StatusTone =
  | "neutral"
  | "info"
  | "brand"
  | "progress"
  | "success"
  | "waiting"
  | "attention"
  | "danger";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  /** The user has to do something for this application to move forward. */
  needsAction: boolean;
}

export const APPLICATION_STATUS: Record<string, StatusMeta> = {
  draft:                { label: "Draft",          tone: "neutral",   needsAction: false },
  applying:             { label: "Applying",       tone: "info",      needsAction: false },
  applied:              { label: "Applied",        tone: "brand",     needsAction: false },
  interviewing:         { label: "Interviewing",   tone: "progress",  needsAction: false },
  offer:                { label: "Offer",          tone: "success",   needsAction: false },
  rejected:             { label: "Rejected",       tone: "danger",    needsAction: false },
  cancelled:            { label: "Cancelled",      tone: "neutral",   needsAction: false },
  pending_verification: { label: "Verify email",   tone: "waiting",   needsAction: true },
  manual:               { label: "Action needed",  tone: "attention", needsAction: true },
  needs_manual:         { label: "Apply manually", tone: "attention", needsAction: true },
  // Legacy statuses — no longer written, still displayed like needs_manual.
  failed:               { label: "Apply manually", tone: "attention", needsAction: true },
  needs_security_code:  { label: "Apply manually", tone: "attention", needsAction: true },
};

export function statusMeta(status: string): StatusMeta {
  return (
    APPLICATION_STATUS[status] ?? {
      label: status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ") : "Unknown",
      tone: "neutral",
      needsAction: false,
    }
  );
}
