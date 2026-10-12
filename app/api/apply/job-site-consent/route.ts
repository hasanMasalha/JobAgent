import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { jobSiteAutomationConsentAt } from "@/lib/job-site-consent.server";

// The job-site automation notice (/dashboard/job-site-extension).
// GET: whether the signed-in user has accepted it. POST { understood: true }:
// record it. The first acceptance is kept.

export async function GET() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const at = await jobSiteAutomationConsentAt(user.id);
  return NextResponse.json({ consented: !!at, consentedAt: at?.toISOString() ?? null });
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body?.understood !== true) {
    return NextResponse.json({ error: "understood must be true" }, { status: 400 });
  }

  await db.$executeRaw`
    UPDATE "User"
    SET job_site_automation_consent_at = COALESCE(job_site_automation_consent_at, now())
    WHERE id = ${user.id}
  `;
  const at = await jobSiteAutomationConsentAt(user.id);
  return NextResponse.json({ consented: !!at, consentedAt: at?.toISOString() ?? null });
}
