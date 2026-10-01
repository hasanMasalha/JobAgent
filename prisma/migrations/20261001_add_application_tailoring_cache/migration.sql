-- Lets /api/apply/prepare reuse a draft instead of tailoring again. A draft
-- is returned as is while tailored_cv_hash (SHA-256 of the CV raw_text it
-- was tailored from) still matches the user's CV; cv_changes keeps Claude's
-- change list with the CV it describes. Additive and nullable: drafts made
-- before this have no hash and are reused once as they are, with no list.
ALTER TABLE "Application" ADD COLUMN "cv_changes" JSONB;
ALTER TABLE "Application" ADD COLUMN "tailored_cv_hash" TEXT;
