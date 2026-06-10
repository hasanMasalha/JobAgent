import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase.server"
import { db } from "@/lib/db"
import { CATEGORY_KEYWORDS } from "@/lib/job-categories"

export async function GET(_req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const searches = await db.savedSearch.findMany({
    where: { user_id: user.id },
    orderBy: { created_at: "asc" },
  })
  return NextResponse.json({ searches })
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { category, keywords: bodyKeywords, locations = [], seniorities = [] } = body
  if (!category) return NextResponse.json({ error: "category required" }, { status: 400 })

  const keywords = bodyKeywords ?? CATEGORY_KEYWORDS[category] ?? []

  const search = await db.savedSearch.upsert({
    where: { user_id_category: { user_id: user.id, category } },
    update: { locations, seniorities, keywords },
    create: { user_id: user.id, category, keywords, locations, seniorities },
  })
  return NextResponse.json({ search })
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  await db.savedSearch.deleteMany({ where: { id, user_id: user.id } })
  return NextResponse.json({ ok: true })
}
