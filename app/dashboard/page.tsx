"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
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

export default function DashboardPage() {
  const router = useRouter()
  const [searches, setSearches] = useState<SavedSearch[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSearch, setEditingSearch] = useState<SavedSearch | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

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
