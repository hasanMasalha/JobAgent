import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  sendApplicationConfirmationEmail,
  sendNeedsManualEmail,
} from "@/lib/email";
import { generateCVDocx } from "@/lib/generate-cv";

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
        user_id: string;
        user_email: string;
        user_name: string | null;
        job_title: string;
        company: string;
        job_url: string;
        applied_at: Date;
        email_notifications: boolean;
        status: string;
        tailored_cv: string | null;
      }[]
    >`
      SELECT a.user_id, u.email AS user_email, u.name AS user_name, j.title AS job_title,
             j.company, COALESCE(j.apply_url, j.url) AS job_url,
             a.applied_at, u.email_notifications, a.status, a.tailored_cv
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

    if (row.status === "needs_manual") {
      let cvAttachment: { filename: string; content: Buffer } | undefined;
      if (row.tailored_cv) {
        const cvRows = await db.$queryRaw<{ hyperlinks_json: string | null }[]>`
          SELECT hyperlinks_json FROM "CV" WHERE user_id = ${row.user_id} LIMIT 1
        `;
        const hyperlinks = JSON.parse(cvRows[0]?.hyperlinks_json ?? "[]");
        const buffer = await generateCVDocx(row.tailored_cv, row.job_title, hyperlinks);
        cvAttachment = { filename: `${row.company}_${row.job_title}_CV.docx`.replace(/\s+/g, "_"), content: buffer };
      }
      await sendNeedsManualEmail({
        userEmail: row.user_email,
        userName: row.user_name ?? "",
        jobTitle: row.job_title,
        company: row.company,
        jobUrl: row.job_url,
        applicationId: application_id,
        cvAttachment,
      });
    } else {
      // "applied" (and any legacy row) — confirmation as before.
      await sendApplicationConfirmationEmail({
        userEmail: row.user_email,
        userName: row.user_name ?? "",
        jobTitle: row.job_title,
        company: row.company,
        appliedAt: row.applied_at,
        applicationId: application_id,
      });
    }

    return NextResponse.json({ success: true, sent_to: row.user_email });
  } catch (err) {
    console.error("[email/send-application-confirmation]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
