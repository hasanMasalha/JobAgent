"use client"

import { useEffect, useState } from "react"
import { LOCATIONS, SENIORITY_LEVELS } from "@/lib/job-categories"
import { Button, Card, RemovableTag } from "@/app/components/ui"
import { cn } from "@/lib/cn"

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

  const panelId = `saved-search-${search.id}`
  const confirming = deleteConfirm === search.id

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 pr-3 sm:pr-4">
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          aria-expanded={isExpanded}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-2.5 py-4 pl-4 text-left transition-colors hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:pl-5"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={cn("h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-200", isExpanded && "rotate-90")}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M6 3.5L10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate text-title-card text-ink">{localSearch.category}</span>
        </button>

        {/* Right: Search btn when collapsed, Edit+Delete when expanded */}
        <div className="shrink-0">
          {!isExpanded ? (
            <Button size="sm" onClick={() => onSearch(search.id)}>
              Search
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(localSearch)}
                title="Edit search"
                aria-label={`Edit ${localSearch.category} search`}
              >
                <PencilIcon />
              </Button>
              <Button
                variant={confirming ? "danger" : "ghost"}
                size="sm"
                onClick={() => onDelete(search.id)}
                title={confirming ? "Click again to confirm" : "Delete search"}
                aria-label={confirming ? `Confirm deleting ${localSearch.category} search` : `Delete ${localSearch.category} search`}
              >
                <TrashIcon />
                {confirming && <span>Delete?</span>}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div id={panelId} className="space-y-4 border-t border-line px-4 pb-4 pt-4 sm:px-5">
          {localSearch.keywords.length > 0 && (
            <TagGroup label="Keywords">
              {localSearch.keywords.map((kw) => (
                <RemovableTag key={kw} label={kw} onRemove={() => removeKeyword(kw)} />
              ))}
            </TagGroup>
          )}

          {localSearch.locations.length > 0 && (
            <TagGroup label="Locations">
              {localSearch.locations.map((loc) => (
                <RemovableTag key={loc} label={getLocationLabel(loc)} onRemove={() => removeLocation(loc)} />
              ))}
            </TagGroup>
          )}

          {localSearch.seniorities.length > 0 && (
            <TagGroup label="Seniority">
              {localSearch.seniorities.map((sen) => (
                <RemovableTag key={sen} label={getSeniorityLabel(sen)} onRemove={() => removeSeniority(sen)} />
              ))}
            </TagGroup>
          )}

          <div className="flex justify-end">
            <Button onClick={() => onSearch(search.id)}>Search jobs</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function TagGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-caption font-semibold text-ink-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M10.5 3l2.5 2.5L6 12.5H3.5V10L10.5 3z" strokeLinejoin="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
