import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Loading";

export type ButtonVariant =
  | "primary"    // the one main action in a view
  | "secondary"  // everything else that's still a button
  | "ghost"      // low-emphasis, toolbar/inline actions
  | "danger"     // destructive
  | "attention"  // the user must act to unblock something (Apply manually)
  | "waiting"    // the user must confirm something external (Verify email)
  | "current";   // a state, not an action — e.g. "Current plan" on pricing

export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans font-semibold rounded-control " +
  "transition-colors duration-150 select-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-brand-on hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "bg-surface text-ink border border-line-strong hover:bg-surface-sunken disabled:opacity-50 disabled:cursor-not-allowed",
  ghost:
    "text-ink-muted hover:text-ink hover:bg-surface-sunken disabled:opacity-50 disabled:cursor-not-allowed",
  danger:
    "bg-surface text-danger-text border border-danger/40 hover:bg-danger-soft disabled:opacity-50 disabled:cursor-not-allowed",
  attention:
    "bg-attention-text text-surface hover:bg-attention-text/90 disabled:opacity-50 disabled:cursor-not-allowed",
  waiting:
    "bg-waiting-text text-surface hover:bg-waiting-text/90 disabled:opacity-50 disabled:cursor-not-allowed",
  // Stays fully legible when disabled — it's information, not a dead button.
  current:
    "bg-brand-soft text-brand-text border border-brand/30 cursor-default",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-body-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-body",
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

/** Classes for anything that should look like a button — use on <Link>/<a>. */
export function buttonStyles({ variant = "primary", size = "md", block }: ButtonStyleOptions = {}) {
  return cn(base, variants[variant], sizes[size], block && "w-full");
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    ButtonStyleOptions {
  /** Shows a spinner and marks the button busy. Does not disable it by itself. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, loading, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      className={cn(buttonStyles({ variant, size, block }), className)}
      {...rest}
    >
      {loading && <Spinner size="sm" decorative />}
      {variant === "current" && !loading && <CheckGlyph />}
      {children}
    </button>
  );
});

function CheckGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
