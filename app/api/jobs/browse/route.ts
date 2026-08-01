import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { detectApplyType, extractRecruiterEmail } from "@/lib/detect-apply-type";
import { normalizePlan } from "@/lib/plan-limits";
import { checkAndIncrementBrowseJobs } from "@/lib/usage";

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 50;

const JUNIOR_SEARCH_KEYWORDS = ["junior", "entry", "graduate"];
const SENIOR_TITLE_KEYWORDS = [
  "senior", "sr.", "staff", "principal", "lead",
  "director", "manager", "vp", "head of", "chief",
];

// Postgres treats %, _ and \ as special inside LIKE/ILIKE patterns — escape
// them so a search term like "50% off" or "under_score" doesn't behave like
// a wildcard (matches what Prisma's `contains` would already do for us).
function likePattern(value: string): string {
  return `%${value.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}

type JobRow = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  source: string;
  apply_type: string | null;
  recruiter_email: string | null;
  salary_min: number | null;
  salary_max: number | null;
  scraped_at: Date;
  is_active: boolean;
  description: string;
};

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { plan: true } });
  const plan = normalizePlan(dbUser?.plan);

  if (plan === "free") {
    return NextResponse.json(
      {
        error: "plan_restricted",
        feature: "browseJobs",
        message: "Browse All Jobs is available on Pro and Unlimited plans",
        upgrade_url: "/pricing",
      },
      { status: 403 }
    );
  }

  const precheck = await checkAndIncrementBrowseJobs(user.id, plan, 0);
  if (!precheck.allowed) {
    return NextResponse.json(
      {
        error: "limit_reached",
        feature: "browseJobs",
        message: "You've reached your daily Browse All Jobs limit. Upgrade for more.",
        upgrade_url: "/pricing",
      },
      { status: 403 }
    );
  }

  const sp = req.nextUrl.searchParams;
  const search = sp.get("search")?.trim() ?? "";
  const location = sp.get("location")?.trim() ?? "";
  const company = sp.get("company")?.trim() ?? "";
  const source = sp.get("source")?.trim() ?? "";
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const limit = Math.min(LIMIT_MAX, Math.max(1, Number(sp.get("limit") ?? LIMIT_DEFAULT)));

  const isJuniorSearch = JUNIOR_SEARCH_KEYWORDS.some((k) => search.toLowerCase().includes(k));

  const conditions: Prisma.Sql[] = [Prisma.sql`j.is_active IS NOT FALSE`];

  if (search) {
    const pattern = likePattern(search);
    conditions.push(
      Prisma.sql`(j.title ILIKE ${pattern} OR j.company ILIKE ${pattern} OR j.description ILIKE ${pattern})`
    );
  }
  if (location) {
    conditions.push(Prisma.sql`j.location ILIKE ${likePattern(location)}`);
  }
  if (company) {
    conditions.push(Prisma.sql`j.company ILIKE ${likePattern(company)}`);
  }
  if (source) {
    conditions.push(Prisma.sql`j.source = ${source}`);
  }
  if (isJuniorSearch) {
    // Searching for a junior/entry/graduate role — exclude senior-flavored
    // titles outright rather than just ranking them lower.
    const seniorConditions = SENIOR_TITLE_KEYWORDS.map(
      (k) => Prisma.sql`j.title ILIKE ${`%${k}%`}`
    );
    conditions.push(Prisma.sql`NOT (${Prisma.join(seniorConditions, " OR ")})`);
  }

  const whereClause = Prisma.join(conditions, " AND ");

  // Relevance: a title/company match ranks above a description-only match,
  // so e.g. searching "junior" surfaces jobs titled "Junior Engineer" before
  // jobs that merely mention "junior" somewhere in a longer description.
  // Cast to ::int (not a bare literal) — Postgres parses a plain integer in
  // ORDER BY as a positional column reference ("ORDER BY 0"), which throws
  // "ORDER BY position 0 is not in select list" for the no-search case.
  const relevanceExpr = search
    ? Prisma.sql`CASE
        WHEN j.title ILIKE ${likePattern(search)} OR j.company ILIKE ${likePattern(search)} THEN 2
        WHEN j.description ILIKE ${likePattern(search)} THEN 1
        ELSE 0
      END`
    : Prisma.sql`0::int`;

  try {
    const [jobs, countResult] = await Promise.all([
      db.$queryRaw<JobRow[]>`
        SELECT j.id, j.title, j.company, j.location, j.url, j.source,
               j.salary_min, j.salary_max, j.scraped_at, j.description,
               j.apply_type, j.recruiter_email, j.is_active
        FROM "Job" j
        WHERE ${whereClause}
        ORDER BY (${relevanceExpr}) DESC, j.scraped_at DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}
      `,
      db.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM "Job" j WHERE ${whereClause}
      `,
    ]);
    const total = Number(countResult[0]?.total ?? 0);

    const { allowed, granted } = await checkAndIncrementBrowseJobs(user.id, plan, jobs.length);
    if (!allowed) {
      return NextResponse.json(
        {
          error: "limit_reached",
          feature: "browseJobs",
          message: "You've reached your daily Browse All Jobs limit. Upgrade for more.",
          upgrade_url: "/pricing",
        },
        { status: 403 }
      );
    }
    const grantedJobs = jobs.slice(0, granted);

    return NextResponse.json({
      jobs: grantedJobs.map((j: (typeof grantedJobs)[number]) => ({
        ...j,
        description: j.description ?? "",
        apply_type: j.apply_type ?? detectApplyType({ url: j.url, source: j.source, description: j.description ?? "" }),
        recruiter_email: j.recruiter_email ?? extractRecruiterEmail(j.description ?? ""),
      })),
      total,
      page,
      total_pages: Math.ceil(total / limit),
      limit,
    });
  } catch (err) {
    console.error("[browse]", err);
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
  }
}
