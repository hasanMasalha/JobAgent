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

type Segment = { type: "header" | "bullet" | "paragraph"; content: string }

function parseDescription(text: string): Segment[] {
  if (!text) return []

  // STEP 1: Insert newlines before known section headers
  const withBreaks = text
    .replace(/\s+(What you('ll| will) (do|be doing)[:\s])/gi, "\n\n$1")
    .replace(/\s+(What we('re| are) looking for[:\s])/gi, "\n\n$1")
    .replace(/\s+(Requirements?[:\s])/gi, "\n\n$1")
    .replace(/\s+(Responsibilities?[:\s])/gi, "\n\n$1")
    .replace(/\s+(Qualifications?[:\s])/gi, "\n\n$1")
    .replace(/\s+(About (us|the role|the team|the position)[:\s])/gi, "\n\n$1")
    .replace(/\s+(Key responsibilities[:\s])/gi, "\n\n$1")
    .replace(/\s+(Nice to have[:\s])/gi, "\n\n$1")
    .replace(/\s+(Bonus points?[:\s])/gi, "\n\n$1")
    .replace(/\s+(Benefits?[:\s])/gi, "\n\n$1")
    .replace(/\s+(Why join us[:\s])/gi, "\n\n$1")
    .replace(/\s+(How you('ll| will)[:\s])/gi, "\n\n$1")
    .replace(/\s+(Your (role|responsibilities)[:\s])/gi, "\n\n$1")
    .replace(/\s+(Job (description|summary)[:\s])/gi, "\n\n$1")
    .replace(/\s+(Overview[:\s])/gi, "\n\n$1")
    .replace(/\s+(מה תעשה|דרישות|תחומי אחריות|אודות|יתרון)[:\s]/gi, "\n\n$1")

  // STEP 2: Split inline numbered lists and sentence-boundary bullets
  const withListBreaks = withBreaks
    .replace(/\s+(\d+\.\s+[A-Z])/g, "\n$1")
    .replace(/\.\s+([A-Z][a-z]+(?:ing|ion|ment|ure|ity|ance|ence)\s)/g, ".\n$1")

  // STEP 3: Split into lines and classify
  const lines = withListBreaks
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  return lines.map((line): Segment => {
    if (
      (line.endsWith(":") && line.length < 80 && !line.match(/\.\s/)) ||
      (line.match(/^(What|About|Key|How|Why|Requirements?|Responsibilities?|Qualifications?|Benefits?|Bonus|Overview|Summary)/i) &&
        line.length < 80)
    ) {
      return { type: "header", content: line }
    }

    if (line.match(/^[*•\-–]\s/) || line.match(/^\d+\.\s/)) {
      return {
        type: "bullet",
        content: line.replace(/^[*•\-–]\s*/, "").replace(/^\d+\.\s*/, ""),
      }
    }

    return { type: "paragraph", content: line }
  })
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
        <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1.5 leading-relaxed bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 mt-2">
          {parseDescription(cleaned).map((item, i) => {
            if (item.type === "header") {
              return (
                <p key={i} className="font-bold text-gray-900 dark:text-gray-100 mt-3 first:mt-0 text-xs uppercase tracking-wide">
                  {item.content}
                </p>
              )
            }
            if (item.type === "bullet") {
              return (
                <div key={i} className="flex gap-2 items-start ml-2">
                  <span className="text-violet-500 flex-shrink-0 mt-0.5 text-xs">•</span>
                  <span className="text-xs text-gray-600 dark:text-gray-400">{item.content}</span>
                </div>
              )
            }
            return (
              <p key={i} className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                {item.content}
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
