import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase.server"
import { db } from "@/lib/db"
import { LOCATIONS, SENIORITY_LEVELS } from "@/lib/job-categories"

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const search = await db.savedSearch.findFirst({
    where: { id: params.id, user_id: user.id },
  })
  if (!search) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const page = parseInt(req.nextUrl.searchParams.get("page") ?? "1")
  const limit = 20
  const offset = (page - 1) * limit

  // Build keyword patterns for title/description
  const kwPatterns = search.keywords.map((k) => `%${k.toLowerCase()}%`)

  // Build location patterns from location values -> keywords lookup
  const locPatterns: string[] = search.locations.flatMap((locValue) => {
    const loc = LOCATIONS.find((l) => l.value === locValue)
    return loc ? loc.keywords.map((k) => `%${k.toLowerCase()}%`) : [`%${locValue.toLowerCase()}%`]
  })

  // Build seniority patterns from seniority values -> keywords lookup
  const senPatterns: string[] = search.seniorities.flatMap((senValue) => {
    const sen = SENIORITY_LEVELS.find((s) => s.value === senValue)
    return sen ? sen.keywords.map((k) => `%${k.toLowerCase()}%`) : [`%${senValue.toLowerCase()}%`]
  })

  // Build the WHERE clause dynamically
  // Keyword match: title OR description contains any keyword
  // Location match (optional): if locations set, filter by them
  // Seniority match (optional): if seniorities set, filter title by seniority keywords

  type JobRow = {
    id: string
    title: string
    company: string
    description: string
    location: string | null
    url: string
    source: string
    apply_type: string | null
    salary_min: number | null
    salary_max: number | null
    scraped_at: Date
    total: bigint
  }

  // Use raw SQL for LIKE ANY(ARRAY[...]) pattern
  const kwArray = `ARRAY[${kwPatterns.map((_, i) => `$${i + 1}`).join(",")}]`

  let paramIndex = kwPatterns.length + 1
  const locArray = locPatterns.length
    ? `ARRAY[${locPatterns.map(() => `$${paramIndex++}`).join(",")}]`
    : null

  const senArray = senPatterns.length
    ? `ARRAY[${senPatterns.map(() => `$${paramIndex++}`).join(",")}]`
    : null

  const locClause = locArray
    ? `AND LOWER(COALESCE(j.location,'')) LIKE ANY(${locArray})`
    : ""
  const senClause = senArray
    ? `AND (LOWER(j.title) LIKE ANY(${senArray}) OR LOWER(j.description) LIKE ANY(${senArray}))`
    : ""

  const offsetParam = `$${paramIndex++}`
  const limitParam = `$${paramIndex++}`

  const allParams: unknown[] = [...kwPatterns, ...locPatterns, ...senPatterns, offset, limit]

  const rows = await db.$queryRawUnsafe<JobRow[]>(
    `SELECT j.id, j.title, j.company, j.description, j.location, j.url,
            j.source, j.apply_type, j.salary_min, j.salary_max, j.scraped_at,
            COUNT(*) OVER() AS total
     FROM "Job" j
     WHERE j.is_active = true
       AND (
         LOWER(j.title) LIKE ANY(${kwArray})
         OR LOWER(j.description) LIKE ANY(${kwArray})
       )
       ${locClause}
       ${senClause}
     ORDER BY j.scraped_at DESC
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    ...allParams
  )

  const total = rows[0] ? Number(rows[0].total) : 0
  const jobs = rows.map(({ total: _t, ...j }) => ({
    ...j,
    scraped_at: j.scraped_at.toISOString(),
  }))

  return NextResponse.json({
    jobs,
    total,
    page,
    hasMore: offset + jobs.length < total,
    search: {
      id: search.id,
      category: search.category,
      keywords: search.keywords,
      locations: search.locations,
      seniorities: search.seniorities,
    },
  })
}
