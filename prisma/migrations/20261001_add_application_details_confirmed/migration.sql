-- The Easy Apply answer columns had defaults ("30", "2", "Bachelor's Degree",
-- authorised, no sponsorship, no relocation), so every user row carried
-- answers nobody entered and the extension typed them into real applications.
--
-- The defaults are dropped so a new user starts with no answer, and the six
-- columns are cleared for everyone: a stored value couldn't be told apart
-- from a default, and every account at this point is a tester's. From here
-- on a value in these columns is one a user entered.
--
-- application_details_confirmed_at is set when the user saves Profile →
-- Application details or approves the answers on the apply review screen.
-- /api/apply/check-pending sends those six answers to the extension only
-- when it is set.
ALTER TABLE "User" ADD COLUMN "application_details_confirmed_at" TIMESTAMP(3);
ALTER TABLE "User" ALTER COLUMN "notice_period" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "work_authorized" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "requires_sponsorship" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "years_of_experience" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "highest_education" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "willing_to_relocate" DROP DEFAULT;

UPDATE "User"
SET "notice_period" = NULL,
    "work_authorized" = NULL,
    "requires_sponsorship" = NULL,
    "years_of_experience" = NULL,
    "highest_education" = NULL,
    "willing_to_relocate" = NULL;
