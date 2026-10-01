import { cn } from "@/lib/cn";

type CardTone = "default" | "featured" | "sunken";
type CardPadding = "none" | "sm" | "md" | "lg";

const tones: Record<CardTone, string> = {
  default: "bg-surface border border-line",
  // Featured = the one card a view wants you to look at (recommended plan).
  featured: "bg-surface border-2 border-brand shadow-raised",
  sunken: "bg-surface-sunken border border-line",
};

const paddings: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-8",
};

export function cardStyles({ tone = "default", padding = "md" }: { tone?: CardTone; padding?: CardPadding } = {}) {
  return cn("rounded-card", tones[tone], paddings[padding]);
}

export function Card({
  as: Tag = "div",
  tone,
  padding,
  className,
  children,
  ...rest
}: {
  as?: "div" | "section" | "article" | "li" | "aside";
  tone?: CardTone;
  padding?: CardPadding;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn(cardStyles({ tone, padding }), className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Title row for a card: heading on the left, optional action on the right. */
export function CardHeader({
  title,
  description,
  action,
  as: Heading = "h2",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <Heading className="text-title-card text-ink">{title}</Heading>
        {description && <p className="mt-0.5 text-body-sm text-ink-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
