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
