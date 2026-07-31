"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import SavedSearchCard from "./components/SavedSearchCard"
import EditSearchModal from "./components/EditSearchModal"

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
  const used = metricUsed(metric)
  const pct = metric.limit ? Math.min(100, Math.round((used / metric.limit) * 100)) : 100
  const barColor = pct >= 80 ? "bg-red-500" : pct >= 50 ? "bg-yellow-500" : "bg-green-500"

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {used} / {metric.limit}
        </p>
      </div>
      <div className="h-2 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {metric.remaining <= 0 && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-2">
          You&apos;ve reached this limit.{" "}
          <Link href="/pricing" className="underline font-medium">Upgrade your plan</Link>
        </p>
      )}
    </div>
  )
}

function UnlimitedRow({ label, metric }: { label: string; metric: UsageMetric }) {
  return (
    <p className="text-sm text-gray-700 dark:text-gray-300">
      <span className="font-medium">{label}:</span> {metricUsed(metric)}{" "}
      <span className="text-gray-400 dark:text-gray-500">(unlimited)</span>
    </p>
  )
}

function UsageBanner({ usage }: { usage: UsageSummary }) {
  const { plan, usage: metrics } = usage

  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{PLAN_LABELS[plan]}</p>
        {plan === "free" && (
          <Link href="/pricing" className="text-sm font-medium text-violet-600 hover:text-violet-700">
            Upgrade to Pro →
          </Link>
        )}
      </div>

      {plan === "unlimited" ? (
        <div className="space-y-2">
          <UnlimitedRow label="Auto-applies" metric={metrics.autoApplies} />
          <UnlimitedRow label="CV tailoring" metric={metrics.cvTailoring} />
        </div>
      ) : (
        <div className="space-y-4">
          {plan === "free" && <UsageRow label="AI Matches today" metric={metrics.jobMatches} />}
          <UsageRow label="Auto-applies/month" metric={metrics.autoApplies} />
          <UsageRow label="CV tailoring/month" metric={metrics.cvTailoring} />
        </div>
      )}
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{body}</p>
        <div className="flex flex-col gap-2">
          <Link
            href="/pricing"
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            {upgradeLabel}
          </Link>
          <button
            onClick={onDismiss}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-2"
          >
            Maybe later
          </button>
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
    <div className="max-w-2xl mx-auto w-full">
      {usage && <UsageBanner usage={usage} />}
      {usage && limitReachedFeature && !dismissedLimitModal && (
        <LimitReachedModal
          feature={limitReachedFeature}
          plan={usage.plan}
          onDismiss={() => setDismissedLimitModal(true)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Saved Searches</h1>
        <button
          onClick={handleNewSearch}
          className="text-sm font-medium px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
        >
          + New Search
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 animate-pulse"
            >
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : searches.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 dark:text-gray-400 mb-4">No saved searches yet</p>
          <button
            onClick={handleNewSearch}
            className="text-violet-600 hover:underline text-sm"
          >
            Create your first search →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {searches.map((search) => (
            <SavedSearchCard
              key={search.id}
              search={search}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onSearch={handleSearch}
              deleteConfirm={deleteConfirm}
            />
          ))}
        </div>
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
