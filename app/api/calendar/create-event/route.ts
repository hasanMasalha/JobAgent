import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { createInterviewEvent } from "@/lib/google-calendar";

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { application_id, date, time, notes } = body as {
      application_id: string;
      date: string;
      time: string;
      notes?: string;
    };

    if (!application_id || !date || !time) {
      return NextResponse.json(
        { error: "application_id, date, and time are required" },
        { status: 422 }
      );
    }

    // Get user's Google tokens
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: {
        google_access_token: true,
        google_refresh_token: true,
        google_connected: true,
      },
    });

    if (!dbUser?.google_connected || !dbUser.google_access_token) {
      return NextResponse.json(
        { error: "Google Calendar not connected" },
        { status: 400 }
      );
    }

    // Get job title and company via application → job join
    const application = await db.application.findFirst({
      where: { id: application_id, user_id: user.id },
      include: { job: { select: { title: true, company: true } } },
    });

    if (!application) {
      return NextResponse.json(
        { error: "Application not found" },
        { status: 404 }
      );
    }

    const interviewDate = new Date(`${date}T${time}:00`);

    const eventUrl = await createInterviewEvent({
      accessToken: dbUser.google_access_token,
      refreshToken: dbUser.google_refresh_token ?? "",
      jobTitle: application.job.title,
      company: application.job.company,
      interviewDate,
      notes,
    });

    return NextResponse.json({ success: true, eventUrl });
  } catch (err) {
    console.error("[calendar/create-event POST]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
