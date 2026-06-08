import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function POST(req: NextRequest) {
  try {
    const { jobId, url } = await req.json()
    if (!jobId || !url) {
      return NextResponse.json({ ok: false })
    }

    const pythonUrl = process.env.PYTHON_SERVICE_URL || "http://fastapi:8000"

    const res = await fetch(
      `${pythonUrl}/test-job-check?url=${encodeURIComponent(url)}`,
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
