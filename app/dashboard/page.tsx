"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import SavedSearchCard from "./components/SavedSearchCard"
import EditSearchModal from "./components/EditSearchModal"
import { Button, Card, CardHeader, EmptyState, Meter, PageHeader, Skeleton, buttonStyles } from "@/app/components/ui"

interface SavedSearch {
  id: string
  category: string
  keywords: string[]
  locations: string[]
  seniorities: string[]
  created_at: string
}

interface UsageMetric {
  limit: number
  remaining: number
  today?: number
  thisMonth?: number
}

interface UsageSummary {
  plan: "free" | "pro" | "unlimited"
  usage: {
    jobMatches: UsageMetric
    autoApplies: UsageMetric
    cvTailoring: UsageMetric
  }
  resetDates: { daily: string; monthly: string }
}

const PLAN_LABELS: Record<UsageSummary["plan"], string> = {
  free: "Free Plan",
  pro: "Pro Plan",
  unlimited: "Unlimited Plan",
}

function metricUsed(m: UsageMetric): number {
  return m.today ?? m.thisMonth ?? 0
}

function UsageRow({ label, metric }: { label: string; metric: UsageMetric }) {
  return (
    <Meter label={label} used={metricUsed(metric)} limit={metric.limit}>
      {metric.remaining <= 0 && (
        <span className="text-danger-text">
          You&apos;ve reached this limit.{" "}
          <Link href="/pricing" className="font-semibold underline underline-offset-2 hover:no-underline">
            Upgrade your plan
          </Link>
        </span>
      )}
    </Meter>
  )
}

function UnlimitedRow({ label, metric }: { label: string; metric: UsageMetric }) {
  return <Meter label={label} used={metricUsed(metric)} limit={null} />
}

function UsageBanner({ usage }: { usage: UsageSummary }) {
  const { plan, usage: metrics } = usage

  return (
    <Card as="section" aria-label="Plan usage" className="mb-section">
      <CardHeader
        title={PLAN_LABELS[plan]}
        action={
          plan === "free" && (
            <Link
              href="/pricing"
              className="rounded-sm text-body-sm font-semibold text-brand-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Upgrade to Pro
            </Link>
          )
        }
      />

      {plan === "unlimited" ? (
        <div className="space-y-2.5">
          <UnlimitedRow label="Auto-applies" metric={metrics.autoApplies} />
          <UnlimitedRow label="CV tailoring" metric={metrics.cvTailoring} />
        </div>
      ) : (
        <div className="space-y-4">
          {plan === "free" && <UsageRow label="AI matches today" metric={metrics.jobMatches} />}
          <UsageRow label="Auto-applies this month" metric={metrics.autoApplies} />
          <UsageRow label="CV tailoring this month" metric={metrics.cvTailoring} />
        </div>
      )}
    </Card>
  )
}

function LimitReachedModal({
  feature,
  plan,
  onDismiss,
}: {
  feature: "matches" | "autoApplies" | "cvTailoring"
  plan: UsageSummary["plan"]
  onDismiss: () => void
}) {
  const copy: Record<typeof feature, { title: string; body: string }> = {
    matches: {
      title: "You've reached your daily match limit",
      body: "Upgrade to Pro for 100 matches/day.",
    },
    autoApplies: {
      title: "You've reached your monthly auto-apply limit",
      body: "Upgrade to Pro for 100 auto-applies/month.",
    },
    cvTailoring: {
      title: "You've reached your monthly CV tailoring limit",
      body: "Upgrade to Pro for 100 CV tailorings/month.",
    },
  }
  const { title, body } = copy[feature]
  const upgradeLabel = plan === "pro" ? "Upgrade to Unlimited" : "Upgrade to Pro - $24/month"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 px-gutter">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="limit-modal-title"
        className="w-full max-w-sm rounded-overlay bg-surface p-6 text-center shadow-overlay"
      >
        <h2 id="limit-modal-title" className="mb-2 text-title-card text-ink">{title}</h2>
        <p className="mb-6 text-body-sm text-ink-muted">{body}</p>
        <div className="flex flex-col gap-2">
          <Link href="/pricing" className={buttonStyles({ block: true })}>
            {upgradeLabel}
          </Link>
          <Button variant="ghost" block onClick={onDismiss}>
            Maybe later
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [searches, setSearches] = useState<SavedSearch[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSearch, setEditingSearch] = useState<SavedSearch | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [dismissedLimitModal, setDismissedLimitModal] = useState(false)

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => { if (!d.cv) router.replace("/dashboard/onboarding") })
      .catch(() => {})

    fetch("/api/saved-searches")
      .then((r) => r.json())
      .then((d) => setSearches(d.searches ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))

    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => { if (d.usage) setUsage(d) })
      .catch(() => {})
  }, [router])

  const handleNewSearch = () => {
    setEditingSearch(null)
    setIsModalOpen(true)
  }

  const handleEdit = (search: SavedSearch) => {
    setEditingSearch(search)
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id)
      // Auto-reset after 3 s if not confirmed
      setTimeout(
        () => setDeleteConfirm((prev) => (prev === id ? null : prev)),
        3000
      )
      return
    }
    await fetch(`/api/saved-searches/${id}`, { method: "DELETE" })
    setSearches((prev) => prev.filter((s) => s.id !== id))
    setDeleteConfirm(null)
  }

  const handleSave = (updated: SavedSearch) => {
    setSearches((prev) => {
      const exists = prev.find((s) => s.id === updated.id)
      if (exists) return prev.map((s) => (s.id === updated.id ? updated : s))
      return [...prev, updated]
    })
  }

  const handleSearch = (id: string) => {
    router.push(`/dashboard/search/${id}`)
  }

  const limitReachedFeature =
    usage && usage.plan !== "unlimited"
      ? usage.usage.jobMatches.remaining <= 0 && usage.plan === "free"
        ? "matches"
        : usage.usage.autoApplies.remaining <= 0
        ? "autoApplies"
        : usage.usage.cvTailoring.remaining <= 0
        ? "cvTailoring"
        : null
      : null

  return (
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader
        title="Saved searches"
        description="Rerun a search to pull the latest matching jobs."
        actions={
          <Button onClick={handleNewSearch}>
            <PlusIcon />
            New search
          </Button>
        }
      />
      {usage && <UsageBanner usage={usage} />}
      {usage && limitReachedFeature && !dismissedLimitModal && (
        <LimitReachedModal
          feature={limitReachedFeature}
          plan={usage.plan}
          onDismiss={() => setDismissedLimitModal(true)}
        />
      )}

      {/* Body */}
      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading saved searches">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-8 w-20" />
            </Card>
          ))}
        </div>
      ) : searches.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title="No saved searches yet"
          action={<Button onClick={handleNewSearch}>Create your first search</Button>}
        >
          Pick a job category, keywords and locations once, then rerun the search whenever you want fresh jobs.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {searches.map((search) => (
            <li key={search.id}>
              <SavedSearchCard
                search={search}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onSearch={handleSearch}
                deleteConfirm={deleteConfirm}
              />
            </li>
          ))}
        </ul>
      )}

      <EditSearchModal
        search={editingSearch}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        existingCategories={searches.map((s) => s.category)}
      />
    </div>
  )
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <circle cx="8.75" cy="8.75" r="5.25" />
      <path d="M12.75 12.75L16.5 16.5" strokeLinecap="round" />
    </svg>
  )
}
