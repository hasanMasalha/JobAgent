"use client"

import { useEffect, useState } from "react"
import { Button, Input, RemovableTag, chipStyles } from "@/app/components/ui"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-gutter font-sans">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-search-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-overlay bg-surface shadow-overlay"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4 sm:px-6">
          <h2 id="edit-search-title" className="text-title-section text-ink">
            {search ? "Edit search" : "New search"}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </Button>
        </div>

        <div className="space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          {/* Category */}
          <fieldset>
            <legend className="mb-2 text-body-sm font-semibold text-ink">Category</legend>
            <div className="flex flex-wrap gap-2">
              {JOB_CATEGORIES.map((cat) => {
                const isTaken = takenCategories.includes(cat)
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => !isTaken && handleCategoryChange(cat)}
                    disabled={isTaken}
                    aria-pressed={category === cat}
                    title={isTaken ? "You already have a search for this category" : undefined}
                    className={chipStyles({ selected: category === cat, disabled: isTaken })}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {/* Keywords */}
          <div>
            <label htmlFor="edit-search-keyword" className="mb-2 block text-body-sm font-semibold text-ink">
              Keywords
            </label>
            {keywords.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {keywords.map((kw) => (
                  <RemovableTag
                    key={kw}
                    label={kw}
                    onRemove={() => setKeywords((prev) => prev.filter((k) => k !== kw))}
                  />
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                id="edit-search-keyword"
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addKeyword()}
                placeholder="Add a keyword and press Enter"
                className="flex-1"
              />
              <Button variant="secondary" onClick={addKeyword}>
                Add
              </Button>
            </div>
          </div>

          {/* Locations */}
          <fieldset>
            <legend className="mb-2 text-body-sm font-semibold text-ink">Locations</legend>
            <div className="flex flex-wrap gap-2">
              {LOCATIONS.map((loc) => (
                <button
                  key={loc.value}
                  type="button"
                  onClick={() => toggleLocation(loc.value)}
                  aria-pressed={locations.includes(loc.value)}
                  className={chipStyles({ selected: locations.includes(loc.value) })}
                >
                  {loc.label}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Seniority */}
          <fieldset>
            <legend className="mb-2 text-body-sm font-semibold text-ink">Seniority level</legend>
            <div className="flex flex-wrap gap-2">
              {SENIORITY_LEVELS.map((sen) => (
                <button
                  key={sen.value}
                  type="button"
                  onClick={() => toggleSeniority(sen.value)}
                  aria-pressed={seniorities.includes(sen.value)}
                  className={chipStyles({ selected: seniorities.includes(sen.value) })}
                >
                  {sen.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!category || saving} loading={saving}>
            {saving ? "Saving…" : "Save search"}
          </Button>
        </div>
      </div>
    </div>
  )
}
