-- Work authorisation per country (ai-service/work_authorisation.py). Replaces
-- "Authorized to work in Israel?" and a sponsorship yes/no with no country.
ALTER TABLE "User" ADD COLUMN "work_countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "sponsorship_later_countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "work_auth_confirmed_at" TIMESTAMP(3);

-- Users who said they can work in Israel start with Israel on the list, so the
-- Profile shows it. work_auth_confirmed_at stays NULL: they never said where
-- else they can or can't work, so until they save the list only Israel
-- questions are answered (from the old columns, as before).
UPDATE "User" SET "work_countries" = ARRAY['IL'] WHERE "work_authorized" = true;
