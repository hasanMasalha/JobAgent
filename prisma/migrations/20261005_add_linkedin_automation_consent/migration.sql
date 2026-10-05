-- When the user acknowledged the LinkedIn automation risk notice
-- (/dashboard/linkedin-extension) before using the Chrome extension. NULL =
-- not given: the extension flow isn't offered and the routes that hand
-- applications to the extension refuse. No backfill: nobody has seen the
-- notice yet, so every existing user is asked.
ALTER TABLE "User" ADD COLUMN "linkedin_automation_consent_at" TIMESTAMP(3);
