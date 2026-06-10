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
    .replace(/^[-]{3,}$/gm, "")
    .trim()
}

function parseDescription(text: string): string[] {
  const cleaned = cleanDescription(text)
  if (!cleaned) return []

  return cleaned
    .split(/\n+/)
    .flatMap((line) => {
      line = line.trim()
      if (!line) return []

      if (line.length > 200) {
        return line
          .split(/(?=(?:What |About |Key |Job |Role |How |Why |Requirements?:|Responsibilities?:|Qualifications?:|Benefits?:|Nice to have:|Note:|Skills?:|Experience:|Education:|Overview:|Summary:|Description:))/i)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      }
      return [line]
    })
    .filter((s) => s.length > 0)
}

function isHeader(line: string): boolean {
  return (
    (line.endsWith(":") && line.length < 80 && !line.includes(".")) ||
    (line === line.toUpperCase() && line.length > 3 && line.length < 60 && /[A-Z]/.test(line))
  )
}

function isBullet(line: string): boolean {
  return /^[*•\-–]\s/.test(line) || /^\d+\.\s/.test(line)
}

export function JobDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false)

  const cleaned = cleanDescription(description || "")
  if (!cleaned) return null

  const isTruncated = cleaned.length > 300

  return (
    <div className="mt-2">
      {!expanded ? (
        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3 leading-relaxed">
          {cleaned}
        </p>
      ) : (
        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2 leading-relaxed">
          {parseDescription(cleaned).map((line, i) => {
            if (isHeader(line)) {
              return (
                <p key={i} className="font-semibold text-gray-800 dark:text-gray-200 mt-3 first:mt-0 text-sm">
                  {line}
                </p>
              )
            }
            if (isBullet(line)) {
              return (
                <div key={i} className="flex gap-2 items-start ml-1">
                  <span className="text-violet-500 flex-shrink-0 mt-0.5 text-xs">•</span>
                  <span>{line.replace(/^[*•\-–]\s*/, "").replace(/^\d+\.\s*/, "")}</span>
                </div>
              )
            }
            return (
              <p key={i} className="text-gray-600 dark:text-gray-400">
                {line}
              </p>
            )
          })}
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
          {expanded ? "↑ Show less" : "↓ Show more"}
        </button>
      )}
    </div>
  )
}
