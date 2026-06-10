"use client"

import { useState } from "react"

function cleanDescription(text: string): string {
  if (!text) return ""
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^-{3,}$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim()
}

function FormattedLines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, i) => {
        if (line.match(/^[*•\-]\s/)) {
          return (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-violet-400 flex-shrink-0">•</span>
              <span>{line.replace(/^[*•\-]\s*/, "")}</span>
            </div>
          )
        }
        if (line.endsWith(":") && line.length < 60) {
          return (
            <p key={i} className="font-semibold text-gray-800 dark:text-gray-200 mt-2 first:mt-0">
              {line}
            </p>
          )
        }
        return <p key={i}>{line}</p>
      })}
    </>
  )
}

export function JobDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false)

  const cleaned = cleanDescription(description || "")
  if (!cleaned) return null

  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const isTruncated = lines.length > 3 || cleaned.length > 200

  return (
    <div className="mt-2">
      {!expanded ? (
        // Collapsed: plain text so line-clamp-3 works reliably on text nodes
        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3">
          {cleaned}
        </p>
      ) : (
        // Expanded: full formatted JSX with bullets and section headers
        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
          <FormattedLines lines={lines} />
        </div>
      )}

      {isTruncated && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((prev) => !prev)
          }}
          className="text-violet-600 dark:text-violet-400 text-xs mt-1.5 hover:underline font-medium"
        >
          {expanded ? "Show less ↑" : "Show more ↓"}
        </button>
      )}
    </div>
  )
}
