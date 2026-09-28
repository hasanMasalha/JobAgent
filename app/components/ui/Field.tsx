"use client";

import { createContext, forwardRef, useContext } from "react";
import { cn } from "@/lib/cn";

// Field wires label/hint/error ids to the control inside it, so pages don't
// have to hand-build aria-describedby.
const FieldContext = createContext<{ id: string; describedBy?: string; invalid: boolean } | null>(null);

export function Field({
  id,
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={cn("space-y-1.5", className)}>
        <label htmlFor={id} className="block text-body-sm font-medium text-ink">
          {label}
          {optional && <span className="ml-1 font-normal text-ink-subtle">(optional)</span>}
        </label>
        {children}
        {hint && !error && (
          <p id={hintId} className="text-caption text-ink-subtle">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-caption text-danger-text">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

const control =
  "block w-full rounded-control border bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle " +
  "transition-colors hover:border-ink-subtle " +
  "focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 " +
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle";

/** Classes for a text-like control — use when a raw element is unavoidable. */
export function inputStyles({ invalid }: { invalid?: boolean } = {}) {
  return cn(control, invalid ? "border-danger focus:border-danger focus:ring-danger/30" : "border-line-strong");
}

function useFieldProps(props: Pick<React.AriaAttributes, "aria-describedby" | "aria-invalid"> & { id?: string }) {
  const ctx = useContext(FieldContext);
  const invalid = ctx?.invalid || props["aria-invalid"] === true || props["aria-invalid"] === "true";
  return {
    id: props.id ?? ctx?.id,
    "aria-describedby": props["aria-describedby"] ?? ctx?.describedBy,
    "aria-invalid": invalid || undefined,
    invalid,
  };
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    const { invalid, ...a11y } = useFieldProps(rest);
    return <input ref={ref} {...rest} {...a11y} className={cn(inputStyles({ invalid }), "h-10", className)} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    const { invalid, ...a11y } = useFieldProps(rest);
    return <textarea ref={ref} {...rest} {...a11y} className={cn(inputStyles({ invalid }), "py-2 leading-6", className)} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    const { invalid, ...a11y } = useFieldProps(rest);
    return (
      <select ref={ref} {...rest} {...a11y} className={cn(inputStyles({ invalid }), "h-10 pr-8", className)}>
        {children}
      </select>
    );
  },
);

export function Checkbox({ label, className, ...rest }: { label: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-body-sm text-ink", className)}>
      <input
        type="checkbox"
        {...rest}
        className="h-4 w-4 rounded border-line-strong accent-[rgb(var(--c-brand))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      {label}
    </label>
  );
}
