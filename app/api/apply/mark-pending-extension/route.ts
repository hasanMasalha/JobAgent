import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";

// Marks an application as pending_extension so the Chrome Extension picks it up.
// Accepts either:
//   application_id — update an existing Application (apply page flow)
//   jobId          — find or create an Application for this job (direct auto-apply flow)
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
    const { application_id, jobId } = body;

    if (!application_id && !jobId) {
      return NextResponse.json({ error: "application_id or jobId required" }, { status: 400 });
    }

    let resultApplicationId: string;

    if (application_id) {
      // Apply page flow: application already created by /api/apply/prepare
      await db.$executeRaw`
        UPDATE "Application"
        SET status = 'pending_extension'
        WHERE id = ${application_id} AND user_id = ${user.id}
      `;
      resultApplicationId = application_id;
    } else {
      // Direct auto-apply flow from dashboard: find or create the Application
      const existing = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Application"
        WHERE user_id = ${user.id} AND job_id = ${jobId}
        ORDER BY applied_at DESC
        LIMIT 1
      `;

      if (existing.length > 0) {
        await db.$executeRaw`
          UPDATE "Application"
          SET status = 'pending_extension'
          WHERE id = ${existing[0].id}
        `;
        resultApplicationId = existing[0].id;
      } else {
        const newApp = await db.$queryRaw<{ id: string }[]>`
          INSERT INTO "Application" (id, user_id, job_id, status, applied_at)
          VALUES (gen_random_uuid(), ${user.id}, ${jobId}, 'pending_extension', NOW())
          RETURNING id
        `;
        resultApplicationId = newApp[0].id;
      }
    }

    const cvRows = await db.$queryRaw<{ skills_json: unknown }[]>`
      SELECT skills_json FROM "CV" WHERE user_id = ${user.id} LIMIT 1
    `;
    const skills: string[] = (() => {
      const raw = cvRows[0]?.skills_json;
      if (Array.isArray(raw)) return raw as string[];
      return [];
    })();

    return NextResponse.json({ success: true, application_id: resultApplicationId, skills });
  } catch (err) {
    console.error("[apply/mark-pending-extension]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
