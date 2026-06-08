"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { JOB_CATEGORIES, CATEGORY_KEYWORDS, LOCATIONS, SENIORITY_LEVELS } from "@/lib/job-categories";

interface SavedSearch {
  id: string;
  category: string;
  keywords: string[];
  locations: string[];
  seniorities: string[];
  created_at: string;
}

function AddSearchModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: SavedSearch[];
  onClose: () => void;
  onSaved: (s: SavedSearch) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedSeniorities, setSelectedSeniorities] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const existingCategories = new Set(existing.map((s) => s.category));
  const slotsLeft = 4 - existing.length;

  async function handleSave() {
    if (!selectedCategory) return;
    setSaving(true);
    try {
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: selectedCategory,
          keywords: CATEGORY_KEYWORDS[selectedCategory] ?? [],
          locations: selectedLocations,
          seniorities: selectedSeniorities,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      onSaved(data.search);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add a search</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
        </div>

        {slotsLeft <= 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">You already have 4 saved searches. Remove one first.</p>
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Pick a category ({slotsLeft} slot{slotsLeft !== 1 ? "s" : ""} remaining)
            </p>
            <div className="flex flex-wrap gap-2 mb-5">
              {JOB_CATEGORIES.filter((c) => !existingCategories.has(c)).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                    selectedCategory === cat
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-violet-400"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {selectedCategory && (
              <>
                <div className="mb-4">
                  <p className="text-sm font-medium mb-2 text-gray-800 dark:text-gray-200">Seniority (optional)</p>
                  <div className="flex flex-wrap gap-2">
                    {SENIORITY_LEVELS.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() =>
                          setSelectedSeniorities((prev) =>
                            prev.includes(s.value) ? prev.filter((x) => x !== s.value) : [...prev, s.value]
                          )
                        }
                        className={`px-3 py-1 rounded-full border text-xs transition-colors ${
                          selectedSeniorities.includes(s.value)
                            ? "bg-violet-600 text-white border-violet-600"
                            : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-violet-400"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-5">
                  <p className="text-sm font-medium mb-2 text-gray-800 dark:text-gray-200">Location (optional)</p>
                  <div className="flex flex-wrap gap-2">
                    {LOCATIONS.map((l) => (
                      <button
                        key={l.value}
                        type="button"
                        onClick={() =>
                          setSelectedLocations((prev) =>
                            prev.includes(l.value) ? prev.filter((x) => x !== l.value) : [...prev, l.value]
                          )
                        }
                        className={`px-3 py-1 rounded-full border text-xs transition-colors ${
                          selectedLocations.includes(l.value)
                            ? "bg-violet-600 text-white border-violet-600"
                            : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-violet-400"
                        }`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 border dark:border-gray-600 py-2 rounded text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!selectedCategory || saving}
                className="flex-1 bg-violet-600 text-white py-2 rounded text-sm font-medium hover:bg-violet-700 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Add search"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (!d.cv) router.replace("/dashboard/onboarding");
      })
      .catch(() => {});

    fetch("/api/saved-searches")
      .then((r) => r.json())
      .then((d) => setSearches(d.searches ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await fetch(`/api/saved-searches?id=${id}`, { method: "DELETE" });
      setSearches((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  function getLocationLabels(locationValues: string[]) {
    return locationValues
      .map((v) => LOCATIONS.find((l) => l.value === v)?.label ?? v)
      .join(", ");
  }

  function getSeniorityLabels(seniorityValues: string[]) {
    return seniorityValues
      .map((v) => SENIORITY_LEVELS.find((s) => s.value === v)?.label ?? v)
      .join(", ");
  }

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Saved Searches</h1>
        {searches.length < 4 && (
          <button
            onClick={() => setShowModal(true)}
            className="text-sm font-medium px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
          >
            + New Search
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 dark:bg-gray-600 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : searches.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl p-10 text-center">
          <p className="text-gray-700 dark:text-gray-300 font-medium mb-1">No saved searches yet.</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Add your first search to see matching jobs.</p>
          <button
            onClick={() => setShowModal(true)}
            className="text-sm font-medium px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
          >
            + Add a search
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl divide-y dark:divide-gray-700 overflow-hidden">
          {searches.map((search) => (
            <div key={search.id} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150 group">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 dark:text-white">{search.category}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                  {[
                    search.locations.length > 0 && getLocationLabels(search.locations),
                    search.seniorities.length > 0 && getSeniorityLabels(search.seniorities),
                  ]
                    .filter(Boolean)
                    .join(" · ") || "All locations · All levels"}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                <button
                  onClick={() => handleDelete(search.id)}
                  disabled={deleting === search.id}
                  className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-all disabled:opacity-50"
                  aria-label={`Remove ${search.category}`}
                >
                  {deleting === search.id ? "…" : "Remove"}
                </button>
                <button
                  onClick={() => router.push(`/dashboard/search/${search.id}`)}
                  className="text-sm font-medium px-4 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
                >
                  Search →
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {searches.length > 0 && searches.length < 4 && (
        <button
          onClick={() => setShowModal(true)}
          className="mt-3 w-full border-2 border-dashed dark:border-gray-600 rounded-xl py-3 text-sm text-gray-400 hover:text-violet-600 hover:border-violet-400 dark:hover:border-violet-500 transition-colors"
        >
          + Add another search ({4 - searches.length} slot{4 - searches.length !== 1 ? "s" : ""} left)
        </button>
      )}

      {showModal && (
        <AddSearchModal
          existing={searches}
          onClose={() => setShowModal(false)}
          onSaved={(s) => {
            setSearches((prev) => {
              const filtered = prev.filter((x) => x.id !== s.id);
              return [...filtered, s];
            });
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}
