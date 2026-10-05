import { db } from "@/lib/db";

/** When the user accepted the LinkedIn automation notice, or null. */
export async function linkedInAutomationConsentAt(userId: string): Promise<Date | null> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { linkedin_automation_consent_at: true },
  });
  return row?.linkedin_automation_consent_at ?? null;
}
