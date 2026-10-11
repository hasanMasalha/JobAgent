-- When the user accepted the job-site automation notice
-- (/dashboard/job-site-extension): the extension fills in and submits
-- applications on employer job sites (Greenhouse first) in their browser, and
-- receives their CV to attach. Separate from linkedin_automation_consent_at.
-- NULL = not given: /api/apply/ats-extension/start refuses. No backfill.
ALTER TABLE "User" ADD COLUMN "job_site_automation_consent_at" TIMESTAMP(3);
