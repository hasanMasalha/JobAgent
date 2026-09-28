import { NextRequest, NextResponse } from "next/server";
import { getSessionOrExtensionUserId } from "@/lib/extension-token";
import { db } from "@/lib/db";
import { refundAutoApplyForApplication } from "@/lib/usage";

export async function POST(req: NextRequest) {
  try {
    // Session, or the extension's signed token (its service worker can't send
    // the session cookie). A userId in the body is ignored — it used to be
    // trusted, which let anyone change another user's statuses and refunds.
    const userId = await getSessionOrExtensionUserId(req);
    const { applicationId, status } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!applicationId || !status) {
      return NextResponse.json({ error: "applicationId and status required" }, { status: 400 });
    }

    const allowed = ["applied", "manual", "failed"];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // The extension couldn't submit: give back the auto-apply credit the
    // application holds, if any (at most once — see refundAutoApplyForApplication).
    if (status !== "applied") {
      await refundAutoApplyForApplication(applicationId, userId);
    }

    console.log("[update-status] updating:", applicationId, "to:", status, "for user:", userId);
    await db.$executeRaw`
      UPDATE "Application"
      SET status = ${status}
      WHERE id = ${applicationId} AND user_id = ${userId}
    `;
    console.log("[update-status] done");

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[applications/update-status]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
