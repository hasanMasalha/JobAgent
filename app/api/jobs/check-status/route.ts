import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase.server"
import { db } from "@/lib/db"
import { pythonFetch } from "@/lib/python-service";

// Called by JobCard when a user opens a listing: asks the AI service whether
// the job has closed and deactivates it if so. Requires a session, and checks
// the job's own stored URL — never a URL from the body, which would let a
// caller deactivate any job or make the AI service fetch arbitrary URLs.
export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { jobId } = await req.json()
    if (!jobId || typeof jobId !== "string") {
      return NextResponse.json({ ok: false })
    }

    const job = await db.job.findUnique({ where: { id: jobId }, select: { url: true } })
    if (!job?.url) return NextResponse.json({ ok: false })

    const res = await pythonFetch(`/test-job-check?url=${encodeURIComponent(job.url)}`,
      { signal: AbortSignal.timeout(10000) }
    )

    if (!res.ok) return NextResponse.json({ ok: false })

    const data = await res.json()

    if (data.is_closed) {
      await db.job.update({
        where: { id: jobId },
        data: { is_active: false },
      })
    }

    return NextResponse.json({ ok: true, closed: data.is_closed })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
