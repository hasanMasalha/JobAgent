import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { applicationId: string } }
) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const application = await db.application.findFirst({
    where: {
      id: params.applicationId,
      user_id: user.id,
    },
    select: {
      id: true,
      status: true,
      error_message: true,
      applied_at: true,
      job: {
        select: { title: true, company: true },
      },
    },
  });

  if (!application) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(application);
}
