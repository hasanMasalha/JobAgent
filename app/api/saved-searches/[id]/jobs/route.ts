import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase.server"
import { db } from "@/lib/db"
import { LOCATIONS } from "@/lib/job-categories"

const JUNIOR_OR_BELOW = ['student', 'entry', 'junior']
const SENIOR_OR_ABOVE = ['senior', 'lead', 'director']

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

async function queryJobs(
  keywords: string[],
  locationValues: string[],
  seniorityValues: string[],
  page: number
) {
  const limit = 20
  const offset = (page - 1) * limit

  const kwPatterns = keywords.map((k) => `%${k.toLowerCase()}%`)

  const locPatterns: string[] = locationValues.flatMap((v) => {
    const loc = LOCATIONS.find((l) => l.value === v)
    return loc ? loc.keywords.map((k) => `%${k.toLowerCase()}%`) : [`%${v.toLowerCase()}%`]
  })

  if (kwPatterns.length === 0) {
    return { jobs: [], total: 0 }
  }

  const kwArray = `ARRAY[${kwPatterns.map((_, i) => `$${i + 1}`).join(",")}]`

  let paramIndex = kwPatterns.length + 1
  const locArray = locPatterns.length
    ? `ARRAY[${locPatterns.map(() => `$${paramIndex++}`).join(",")}]`
    : null

  const locClause = locArray
    ? `AND LOWER(COALESCE(j.location,'')) LIKE ANY(${locArray})`
    : ""

  // Seniority: hard-exclude senior titles when only junior/entry/student is selected
  const isJuniorSearch = seniorityValues.some((s) => JUNIOR_OR_BELOW.includes(s))
  const hasSeniorSelected = seniorityValues.some((s) => SENIOR_OR_ABOVE.includes(s))
  const excludeSeniorTitles = isJuniorSearch && !hasSeniorSelected

  const seniorTitleClause = excludeSeniorTitles
    ? `AND LOWER(j.title) NOT SIMILAR TO '%(senior|sr.|principal|architect|staff|lead|manager|director|vp |head of|chief|cto|coo|cfo|distinguished|fellow|group manager|r&d manager|engineering manager)%'`
    : ""

  const yearsClause = excludeSeniorTitles
    ? `AND NOT (j.description ~* '\\y([5-9]|[1-9][0-9])\\+?\\s*years?\\s*(of\\s*)?(experience|exp)\\y')`
    : ""

  const offsetParam = `$${paramIndex++}`
  const limitParam = `$${paramIndex++}`

  const allParams: unknown[] = [...kwPatterns, ...locPatterns, offset, limit]

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
       ${seniorTitleClause}
       ${yearsClause}
     ORDER BY j.scraped_at DESC
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    ...allParams
  )

  const total = rows[0] ? Number(rows[0].total) : 0
  const jobs = rows.map(({ total: _t, ...j }) => ({
    ...j,
    scraped_at: j.scraped_at.toISOString(),
  }))

  return { jobs, total }
}

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

  const { jobs, total } = await queryJobs(
    search.keywords,
    search.locations,
    search.seniorities,
    page
  )

  return NextResponse.json({
    jobs,
    total,
    page,
    hasMore: (page - 1) * limit + jobs.length < total,
    search: {
      id: search.id,
      category: search.category,
      keywords: search.keywords,
      locations: search.locations,
      seniorities: search.seniorities,
    },
  })
}

export async function POST(
  req: NextRequest,
  { params: _params }: { params: { id: string } }
) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { keywords = [], locations = [], seniorities = [], page = 1 } = body as {
    keywords?: string[]
    locations?: string[]
    seniorities?: string[]
    page?: number
  }

  const limit = 20
  const { jobs, total } = await queryJobs(keywords, locations, seniorities, page)

  return NextResponse.json({
    jobs,
    total,
    page,
    hasMore: (page - 1) * limit + jobs.length < total,
  })
}
