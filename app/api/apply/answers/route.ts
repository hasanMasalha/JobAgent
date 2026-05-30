import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

async function getUser() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET(_req: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const answers = await db.easyApplyAnswer.findMany({
      where: { user_id: user.id },
      orderBy: { updated_at: "desc" },
    });

    return NextResponse.json({ answers });
  } catch (err) {
    console.error("[apply/answers GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Allow extension to pass userId directly (cross-site cookie blocked)
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    const body = await req.json();
    const userId = user?.id ?? body.userId;

    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { question, answer } = body;
    if (!question || answer == null) {
      return NextResponse.json({ error: "question and answer required" }, { status: 400 });
    }

    await db.easyApplyAnswer.upsert({
      where: { user_id_question: { user_id: userId, question } },
      create: { user_id: userId, question, answer },
      update: { answer },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[apply/answers POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { question } = await req.json();
    if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });

    await db.easyApplyAnswer.deleteMany({
      where: { user_id: user.id, question },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[apply/answers DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
