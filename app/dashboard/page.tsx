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

interface Usage {
  plan: string
  used: number
  limit: number | null
  matchesUsed?: number
  matchesLimit?: number | null
}

function UsageRow({
  label,
  used,
  limit,
  limitReachedMessage,
}: {
  label: string
  used: number
  limit: number | null
  limitReachedMessage: string
}) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 100
  const barColor =
    limit === null
      ? "bg-green-500"
      : pct >= 80
      ? "bg-red-500"
      : pct >= 50
      ? "bg-yellow-500"
      : "bg-green-500"

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {used} / {limit === null ? "∞" : limit}
        </p>
      </div>
      <div className="h-2 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {limit !== null && pct >= 80 && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-2">
          {limitReachedMessage}{" "}
          <Link href="/pricing" className="underline font-medium">Upgrade your plan</Link>
        </p>
      )}
    </div>
  )
}

function UsageBanner({ usage }: { usage: Usage }) {
  const showMatches =
    typeof usage.matchesUsed === "number" &&
    usage.matchesLimit !== undefined &&
    usage.matchesLimit !== null

  return (
    <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 mb-6 space-y-4">
      <UsageRow
        label="Auto-applies this month"
        used={usage.used}
        limit={usage.limit}
        limitReachedMessage="You're close to your monthly limit."
      />
      {showMatches && (
        <UsageRow
          label="Daily matches today"
          used={usage.matchesUsed!}
          limit={usage.matchesLimit!}
          limitReachedMessage="You're close to your daily match limit."
        />
      )}
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
  const [usage, setUsage] = useState<Usage | null>(null)

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
      .then((d) => { if (typeof d.used === "number") setUsage(d) })
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

  return (
    <div className="max-w-2xl mx-auto w-full">
      {usage && <UsageBanner usage={usage} />}

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
