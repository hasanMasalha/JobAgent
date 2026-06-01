import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

// POST — run cleanup (soft delete 30d, hard delete 90d, deactivate broken URLs)
// GET  — preview what would be cleaned without making changes
// Both protected by INTERNAL_API_KEY header.
//
// Usage:
//   curl -X POST https://jobagent.uk/api/admin/cleanup-jobs \
//     -H "x-api-key: <INTERNAL_API_KEY>"

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-api-key")
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

    // Step 1 — Soft delete: mark jobs older than 30 days as inactive.
    // They stay in DB but are hidden from browse/match queries.
    const softDeleted = await db.job.updateMany({
      where: {
        scraped_at: { lt: thirtyDaysAgo },
        is_active: { not: false },
      },
      data: { is_active: false },
    })
    console.log(`[cleanup] soft deleted: ${softDeleted.count}`)

    // Step 2 — Hard delete: remove jobs older than 90 days with no applications.
    const hardDeleted = await db.$executeRaw`
      DELETE FROM "Job"
      WHERE scraped_at < ${ninetyDaysAgo}
        AND id NOT IN (
          SELECT DISTINCT job_id
          FROM "Application"
          WHERE job_id IS NOT NULL
        )
    `
    console.log(`[cleanup] hard deleted: ${hardDeleted}`)

    // Step 3 — Deactivate jobs with known broken URL patterns.
    const brokenUrls = await db.job.updateMany({
      where: {
        is_active: { not: false },
        OR: [
          { url: { contains: "error=true" } },
          { url: { contains: "?error" } },
          { url: { contains: "job-closed" } },
          { url: { contains: "position-filled" } },
          { url: "" },
        ],
      },
      data: { is_active: false },
    })
    console.log(`[cleanup] broken URLs deactivated: ${brokenUrls.count}`)

    // Step 4 — Report current DB state.
    const [activeCount, inactiveCount, totalCount] = await Promise.all([
      db.job.count({ where: { is_active: true } }),
      db.job.count({ where: { is_active: false } }),
      db.job.count(),
    ])

    const result = {
      success: true,
      timestamp: now.toISOString(),
      softDeleted: softDeleted.count,
      hardDeleted: Number(hardDeleted),
      brokenUrlsDeactivated: brokenUrls.count,
      dbState: {
        active: activeCount,
        inactive: inactiveCount,
        total: totalCount,
      },
    }

    console.log("[cleanup] complete:", result)
    return NextResponse.json(result)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[cleanup] error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET — preview what would be affected without making changes.
export async function GET(req: NextRequest) {
  const key = req.headers.get("x-api-key")
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  const [activeCount, inactiveCount, totalCount, olderThan30, olderThan90, brokenUrls] =
    await Promise.all([
      db.job.count({ where: { is_active: true } }),
      db.job.count({ where: { is_active: false } }),
      db.job.count(),
      db.job.count({ where: { scraped_at: { lt: thirtyDaysAgo }, is_active: true } }),
      db.job.count({ where: { scraped_at: { lt: ninetyDaysAgo } } }),
      db.job.count({
        where: {
          OR: [
            { url: { contains: "error=true" } },
            { url: "" },
          ],
        },
      }),
    ])

  return NextResponse.json({
    dbState: {
      active: activeCount,
      inactive: inactiveCount,
      total: totalCount,
    },
    wouldCleanup: {
      softDelete: olderThan30,
      eligibleForHardDelete: olderThan90,
      brokenUrls,
    },
  })
}
