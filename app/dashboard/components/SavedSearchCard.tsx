"use client"

import { useEffect, useState } from "react"
import { LOCATIONS, SENIORITY_LEVELS } from "@/lib/job-categories"

interface SavedSearch {
  id: string
  category: string
  keywords: string[]
  locations: string[]
  seniorities: string[]
  created_at: string
}

interface Props {
  search: SavedSearch
  onEdit: (search: SavedSearch) => void
  onDelete: (id: string) => void
  onSearch: (id: string) => void
  deleteConfirm: string | null
}

export default function SavedSearchCard({ search, onEdit, onDelete, onSearch, deleteConfirm }: Props) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [localSearch, setLocalSearch] = useState(search)

  // Sync when parent updates the search (e.g. after modal edit)
  useEffect(() => {
    setLocalSearch(search)
  }, [search])

  const getLocationLabel = (value: string) =>
    LOCATIONS.find((l) => l.value === value)?.label ?? value

  const getSeniorityLabel = (value: string) =>
    SENIORITY_LEVELS.find((s) => s.value === value)?.label ?? value

  const patchSearch = async (patch: Partial<SavedSearch>) => {
    await fetch(`/api/saved-searches/${search.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  }

  const removeKeyword = async (keyword: string) => {
    const keywords = localSearch.keywords.filter((k) => k !== keyword)
    setLocalSearch((prev) => ({ ...prev, keywords }))
    await patchSearch({ keywords })
  }

  const removeLocation = async (value: string) => {
    const locations = localSearch.locations.filter((l) => l !== value)
    setLocalSearch((prev) => ({ ...prev, locations }))
    await patchSearch({ locations })
  }

  const removeSeniority = async (value: string) => {
    const seniorities = localSearch.seniorities.filter((s) => s !== value)
    setLocalSearch((prev) => ({ ...prev, seniorities }))
    await patchSearch({ seniorities })
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">

      {/* Header row */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        onClick={() => setIsExpanded((v) => !v)}
      >
        {/* Left: arrow + name */}
        <div className="flex items-center gap-2">
          <span
            className={`text-gray-400 text-xs select-none transition-transform duration-200 ${
              isExpanded ? "rotate-90" : ""
            }`}
          >
            ▶
          </span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {localSearch.category}
          </span>
        </div>

        {/* Right: Search btn when collapsed, Edit+Delete when expanded */}
        <div onClick={(e) => e.stopPropagation()}>
          {!isExpanded ? (
            <button
              onClick={() => onSearch(search.id)}
              className="px-4 py-1.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors"
            >
              Search →
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onEdit(localSearch)}
                className="p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded transition-colors text-sm"
                title="Edit search"
              >
                ✏️
              </button>
              <button
                onClick={() => onDelete(search.id)}
                className={`p-1.5 rounded transition-colors text-sm ${
                  deleteConfirm === search.id
                    ? "text-red-600 bg-red-50 dark:bg-red-900/20"
                    : "text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                }`}
                title={deleteConfirm === search.id ? "Click again to confirm" : "Delete search"}
              >
                {deleteConfirm === search.id ? "⚠️ Delete?" : "🗑️"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700">

          {localSearch.keywords.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Keywords
              </p>
              <div className="flex flex-wrap gap-1.5">
                {localSearch.keywords.map((kw) => (
                  <span
                    key={kw}
                    className="flex items-center gap-1 px-2.5 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full text-xs"
                  >
                    {kw}
                    <button onClick={() => removeKeyword(kw)} className="hover:text-red-500 font-bold ml-0.5">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {localSearch.locations.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Locations
              </p>
              <div className="flex flex-wrap gap-1.5">
                {localSearch.locations.map((loc) => (
                  <span
                    key={loc}
                    className="flex items-center gap-1 px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs"
                  >
                    {getLocationLabel(loc)}
                    <button onClick={() => removeLocation(loc)} className="hover:text-red-500 font-bold ml-0.5">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {localSearch.seniorities.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Seniority
              </p>
              <div className="flex flex-wrap gap-1.5">
                {localSearch.seniorities.map((sen) => (
                  <span
                    key={sen}
                    className="flex items-center gap-1 px-2.5 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs"
                  >
                    {getSeniorityLabel(sen)}
                    <button onClick={() => removeSeniority(sen)} className="hover:text-red-500 font-bold ml-0.5">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              onClick={() => onSearch(search.id)}
              className="px-5 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors"
            >
              Search Jobs →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
