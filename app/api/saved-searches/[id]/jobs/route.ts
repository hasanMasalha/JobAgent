import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase.server"
import { db } from "@/lib/db"
import { LOCATIONS, CATEGORY_KEYWORDS } from "@/lib/job-categories"

const JUNIOR_OR_BELOW = ['student', 'entry level', 'entry', 'junior']
const SENIOR_OR_ABOVE = ['senior', 'lead', 'staff', 'director', 'team lead', 'director+']

const GENERIC_KEYWORDS = [
  'software developer', 'software engineer',
  'developer', 'engineer',
]

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
}

async function queryJobs(
  keywords: string[],
  locationValues: string[],
  seniorities: string[],
  page: number
) {
  const limit = 20
  const offset = (page - 1) * limit

  if (keywords.length === 0) return { jobs: [], total: 0 }

  const isJuniorOnlySearch =
    seniorities.length > 0 &&
    seniorities.every((s) => JUNIOR_OR_BELOW.some((j) => s.includes(j))) &&
    !seniorities.some((s) => SENIOR_OR_ABOVE.some((sr) => s.includes(sr)))

  console.log('[search] seniorities:', seniorities)
  console.log('[search] isJuniorOnlySearch:', isJuniorOnlySearch)

  // PROBLEM 1 FIX: title-only matching — description matching causes too many false positives
  const kwConditions = keywords
    .map((k) => {
      const safe = k.toLowerCase().replace(/'/g, "''")
      return `LOWER(j.title) LIKE '%${safe}%'`
    })
    .join(" OR ")

  const locConditions = locationValues.flatMap((v) => {
    const loc = LOCATIONS.find((l) => l.value === v)
    return loc
      ? loc.keywords.map((k) => {
          const safe = k.toLowerCase().replace(/'/g, "''")
          return `LOWER(COALESCE(j.location,'')) LIKE '%${safe}%'`
        })
      : [`LOWER(COALESCE(j.location,'')) LIKE '%${v.toLowerCase().replace(/'/g, "''")}%'`]
  })

  const locClause = locConditions.length > 0
    ? `AND (${locConditions.join(" OR ")})`
    : ""

  const seniorityExclusion = isJuniorOnlySearch
    ? `AND LOWER(j.title) NOT LIKE '%senior%'
       AND LOWER(j.title) NOT LIKE '%sr.%'
       AND LOWER(j.title) NOT LIKE '%principal%'
       AND LOWER(j.title) NOT LIKE '%architect%'
       AND LOWER(j.title) NOT LIKE '%lead%'
       AND LOWER(j.title) NOT LIKE '%manager%'
       AND LOWER(j.title) NOT LIKE '%director%'
       AND LOWER(j.title) NOT LIKE '%staff%'
       AND LOWER(j.title) NOT LIKE '%head%'
       AND LOWER(j.title) NOT LIKE '%vp%'
       AND LOWER(j.title) NOT LIKE '%chief%'
       AND LOWER(j.title) NOT LIKE '%experienced%'
       AND LOWER(j.title) NOT LIKE '% ii%'
       AND LOWER(j.title) NOT LIKE '% iii%'
       AND LOWER(j.title) NOT LIKE '% iv%'
       AND NOT (
         j.description ~* '\\y[5-9]\\+?\\s*years?\\s*(of\\s*)?experience\\y'
         OR j.description ~* '\\y[1-9][0-9]\\+?\\s*years?\\s*(of\\s*)?experience\\y'
       )`
    : ""

  console.log('[search] seniorityExclusion SQL:', seniorityExclusion)

  const whereClause = `
    WHERE j.is_active = true
      AND j.url IS NOT NULL
      AND (${kwConditions})
      ${locClause}
      ${seniorityExclusion}
  `

  const sql = `
    SELECT j.id, j.title, j.company, j.description, j.location, j.url,
           j.source, j.apply_type, j.salary_min, j.salary_max, j.scraped_at
    FROM "Job" j
    ${whereClause}
    ORDER BY j.scraped_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `

  const countSql = `
    SELECT COUNT(*) AS total
    FROM "Job" j
    ${whereClause}
  `

  console.log('[search] full SQL:', sql)

  const [jobs, countResult] = await Promise.all([
    db.$queryRawUnsafe<JobRow[]>(sql),
    db.$queryRawUnsafe<{ total: bigint }[]>(countSql),
  ])

  const total = Number(countResult[0]?.total ?? 0)

  return {
    jobs: jobs.map((j) => ({
      ...j,
      scraped_at: j.scraped_at.toISOString(),
    })),
    total,
  }
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

  // PROBLEM 3 FIX: replace stale generic keywords with fresh category keywords
  const savedKeywords = search.keywords ?? []
  const categoryKeywords = CATEGORY_KEYWORDS[search.category] ?? []
  const hasGenericKeywords = savedKeywords.some((k) =>
    GENERIC_KEYWORDS.includes(k.toLowerCase())
  )

  const keywords = hasGenericKeywords
    ? categoryKeywords
    : (savedKeywords.length > 0 ? savedKeywords : categoryKeywords)

  if (hasGenericKeywords && categoryKeywords.length > 0) {
    await db.savedSearch.update({
      where: { id: params.id },
      data: { keywords: categoryKeywords },
    })
  }

  const page = parseInt(req.nextUrl.searchParams.get("page") ?? "1")
  const limit = 20

  const { jobs, total } = await queryJobs(
    keywords,
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
      keywords,
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
