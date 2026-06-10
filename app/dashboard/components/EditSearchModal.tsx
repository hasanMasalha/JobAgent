"use client"

import { useEffect, useState } from "react"
import { JOB_CATEGORIES, CATEGORY_KEYWORDS, LOCATIONS, SENIORITY_LEVELS } from "@/lib/job-categories"

interface SavedSearch {
  id: string
  category: string
  keywords: string[]
  locations: string[]
  seniorities: string[]
  created_at: string
}

interface Props {
  search: SavedSearch | null   // null = creating a new search
  isOpen: boolean
  onClose: () => void
  onSave: (updated: SavedSearch) => void
  existingCategories: string[] // prevent duplicate categories
}

export default function EditSearchModal({ search, isOpen, onClose, onSave, existingCategories }: Props) {
  const [category, setCategory] = useState("")
  const [keywords, setKeywords] = useState<string[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [seniorities, setSeniorities] = useState<string[]>([])
  const [newKeyword, setNewKeyword] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    if (search) {
      setCategory(search.category)
      setKeywords(search.keywords ?? [])
      setLocations(search.locations ?? [])
      setSeniorities(search.seniorities ?? [])
    } else {
      setCategory("")
      setKeywords([])
      setLocations([])
      setSeniorities([])
    }
    setNewKeyword("")
  }, [search, isOpen])

  const handleCategoryChange = (cat: string) => {
    setCategory(cat)
    const catKeywords = CATEGORY_KEYWORDS[cat] ?? []
    // Keep any custom keywords (not part of any preset) alongside the new category keywords
    const allPresetKws = new Set(Object.values(CATEGORY_KEYWORDS).flat())
    const customKws = keywords.filter((k) => !allPresetKws.has(k))
    setKeywords(Array.from(new Set([...catKeywords, ...customKws])))
  }

  const addKeyword = () => {
    const kw = newKeyword.trim().toLowerCase()
    if (kw && !keywords.includes(kw)) setKeywords((prev) => [...prev, kw])
    setNewKeyword("")
  }

  const toggleLocation = (value: string) =>
    setLocations((prev) =>
      prev.includes(value) ? prev.filter((l) => l !== value) : [...prev, value]
    )

  const toggleSeniority = (value: string) =>
    setSeniorities((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    )

  const handleSave = async () => {
    if (!category) return
    setSaving(true)
    try {
      const payload = { category, keywords, locations, seniorities }
      const url = search ? `/api/saved-searches/${search.id}` : "/api/saved-searches"
      const method = search ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to save")
      const data = await res.json()
      // POST returns { search: {...} }; PATCH returns the record directly
      onSave(data.search ?? data)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  // When editing, allow the current category to be re-selected
  const takenCategories = existingCategories.filter((c) => c !== search?.category)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            {search ? "Edit Search" : "New Search"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Category
            </label>
            <div className="flex flex-wrap gap-2">
              {JOB_CATEGORIES.map((cat) => {
                const isTaken = takenCategories.includes(cat)
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => !isTaken && handleCategoryChange(cat)}
                    disabled={isTaken}
                    className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                      category === cat
                        ? "bg-violet-600 text-white"
                        : isTaken
                        ? "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Keywords */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Keywords
            </label>
            <div className="flex flex-wrap gap-1.5 mb-3 min-h-[32px]">
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="flex items-center gap-1 px-2.5 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full text-xs"
                >
                  {kw}
                  <button
                    onClick={() => setKeywords((prev) => prev.filter((k) => k !== kw))}
                    className="hover:text-red-500 font-bold ml-0.5 leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                placeholder="Add keyword and press Enter…"
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
              <button
                onClick={addKeyword}
                className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          {/* Locations */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Locations
            </label>
            <div className="flex flex-wrap gap-2">
              {LOCATIONS.map((loc) => (
                <button
                  key={loc.value}
                  type="button"
                  onClick={() => toggleLocation(loc.value)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    locations.includes(loc.value)
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {loc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Seniority */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Seniority Level
            </label>
            <div className="flex flex-wrap gap-2">
              {SENIORITY_LEVELS.map((sen) => (
                <button
                  key={sen.value}
                  type="button"
                  onClick={() => toggleSeniority(sen.value)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    seniorities.includes(sen.value)
                      ? "bg-green-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {sen.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!category || saving}
            className="px-6 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving…" : "Save Search"}
          </button>
        </div>
      </div>
    </div>
  )
}
