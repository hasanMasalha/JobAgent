import { db } from "@/lib/db";

/** When the user accepted the job-site automation notice, or null. */
export async function jobSiteAutomationConsentAt(userId: string): Promise<Date | null> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { job_site_automation_consent_at: true },
  });
  return row?.job_site_automation_consent_at ?? null;
}
