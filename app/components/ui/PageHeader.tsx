/**
 * Top of every dashboard page. The title is the one place the serif
 * "document voice" appears at page level.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 sm:mb-8">
      <div className="min-w-0 max-w-2xl">
        <h1 className="font-serif text-title-page-sm text-ink text-balance sm:text-title-page">{title}</h1>
        {description && <p className="mt-1.5 text-body text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
