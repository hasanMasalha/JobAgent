import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase.server"
import { db } from "@/lib/db"

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const search = await db.savedSearch.findFirst({
    where: { id: params.id, user_id: user.id },
  })

  if (!search) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json(search)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const existing = await db.savedSearch.findFirst({
    where: { id: params.id, user_id: user.id },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json()
  const { category, keywords, locations, seniorities } = body as {
    category?: string
    keywords?: string[]
    locations?: string[]
    seniorities?: string[]
  }

  const updated = await db.savedSearch.update({
    where: { id: params.id },
    data: {
      ...(category !== undefined && { category }),
      ...(keywords !== undefined && { keywords }),
      ...(locations !== undefined && { locations }),
      ...(seniorities !== undefined && { seniorities }),
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await db.savedSearch.deleteMany({ where: { id: params.id, user_id: user.id } })
  return NextResponse.json({ ok: true })
}
