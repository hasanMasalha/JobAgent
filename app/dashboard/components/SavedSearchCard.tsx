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

  const isDeleteConfirm = deleteConfirm === search.id

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        onClick={() => setIsExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-gray-400 text-xs select-none transition-transform duration-200 ${
              isExpanded ? "rotate-90" : ""
            }`}
          >
            ▶
          </span>
          <span className="font-semibold text-gray-900 dark:text-white">{localSearch.category}</span>
          {!isExpanded && (
            <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[240px]">
              {[
                localSearch.keywords.slice(0, 3).join(", "),
                localSearch.locations.map(getLocationLabel).join(", "),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>

        {/* Edit / delete — stopPropagation so row click doesn't toggle expand */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onEdit(localSearch)}
            className="p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded transition-colors"
            title="Edit search"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(search.id)}
            title="Delete search"
            className={`p-1.5 rounded transition-colors text-xs font-medium leading-none ${
              isDeleteConfirm
                ? "bg-red-500 text-white hover:bg-red-600 px-2.5 py-1.5"
                : "text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            }`}
          >
            {isDeleteConfirm ? (
              "Confirm?"
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700">
          {localSearch.keywords.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Keywords</p>
              <div className="flex flex-wrap gap-1.5">
                {localSearch.keywords.map((kw) => (
                  <span
                    key={kw}
                    className="flex items-center gap-1 px-2.5 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full text-xs"
                  >
                    {kw}
                    <button
                      onClick={() => removeKeyword(kw)}
                      className="hover:text-red-500 ml-0.5 font-bold leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {localSearch.locations.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Locations</p>
              <div className="flex flex-wrap gap-1.5">
                {localSearch.locations.map((loc) => (
                  <span
                    key={loc}
                    className="flex items-center gap-1 px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs"
                  >
                    {getLocationLabel(loc)}
                    <button
                      onClick={() => removeLocation(loc)}
                      className="hover:text-red-500 ml-0.5 font-bold leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {localSearch.seniorities.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Seniority</p>
              <div className="flex flex-wrap gap-1.5">
                {localSearch.seniorities.map((sen) => (
                  <span
                    key={sen}
                    className="flex items-center gap-1 px-2.5 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs"
                  >
                    {getSeniorityLabel(sen)}
                    <button
                      onClick={() => removeSeniority(sen)}
                      className="hover:text-red-500 ml-0.5 font-bold leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              onClick={() => onSearch(search.id)}
              className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-sm font-medium transition-colors"
            >
              Search Jobs →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
