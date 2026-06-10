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

function formatDescription(text: string): React.ReactNode[] {
  const cleaned = cleanDescription(text)
  if (!cleaned) return []

  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  return lines.map((line, i) => {
    if (line.match(/^[*•\-]\s/)) {
      return (
        <div key={i} className="flex gap-2 items-start">
          <span className="text-violet-400 mt-0.5 flex-shrink-0 text-xs">•</span>
          <span>{line.replace(/^[*•\-]\s*/, "")}</span>
        </div>
      )
    }
    if (
      (line.endsWith(":") && line.length < 60) ||
      (line === line.toUpperCase() && line.length > 3 && line.length < 50 && /[A-Z]/.test(line))
    ) {
      return (
        <p key={i} className="font-semibold text-gray-800 dark:text-gray-200 mt-2 first:mt-0">
          {line}
        </p>
      )
    }
    return <p key={i}>{line}</p>
  })
}

export function JobDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false)

  const cleaned = cleanDescription(description)
  if (!cleaned) return null

  return (
    <div className="mt-2">
      <div
        className={`text-sm text-gray-600 dark:text-gray-400 space-y-0.5 ${
          !expanded ? "line-clamp-3 overflow-hidden" : ""
        }`}
      >
        {formatDescription(description)}
      </div>

      {cleaned.length > 150 && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(!expanded)
          }}
          className="text-violet-600 dark:text-violet-400 text-xs mt-1 hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}
