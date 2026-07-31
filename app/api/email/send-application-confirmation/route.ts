import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendApplicationConfirmationEmail } from "@/lib/email";

function isAuthorized(req: NextRequest): boolean {
  // Allow calls from localhost
  const forwarded = req.headers.get("x-forwarded-for");
  const host = req.headers.get("host") ?? "";
  const isLocal =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    forwarded === "127.0.0.1";

  // Allow calls with matching internal key
  const internalKey = req.headers.get("x-internal-key");
  const hasValidKey =
    !!process.env.INTERNAL_API_KEY &&
    internalKey === process.env.INTERNAL_API_KEY;

  return isLocal || hasValidKey;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { application_id } = await req.json();
    if (!application_id) {
      return NextResponse.json({ error: "application_id required" }, { status: 400 });
    }

    const rows = await db.$queryRaw<
      {
        user_email: string;
        user_name: string | null;
        job_title: string;
        company: string;
        applied_at: Date;
        email_notifications: boolean;
      }[]
    >`
      SELECT u.email AS user_email, u.name AS user_name, j.title AS job_title,
             j.company, a.applied_at, u.email_notifications
      FROM "Application" a
      JOIN "User" u ON u.id = a.user_id
      JOIN "Job" j ON j.id = a.job_id
      WHERE a.id = ${application_id}
      LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
    const row = rows[0];

    if (row.email_notifications === false) {
      return NextResponse.json({ success: true, skipped: "notifications_off" });
    }

    await sendApplicationConfirmationEmail({
      userEmail: row.user_email,
      userName: row.user_name ?? "",
      jobTitle: row.job_title,
      company: row.company,
      appliedAt: row.applied_at,
      applicationId: application_id,
    });

    return NextResponse.json({ success: true, sent_to: row.user_email });
  } catch (err) {
    console.error("[email/send-application-confirmation]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
