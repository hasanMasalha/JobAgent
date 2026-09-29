-- Caches the Claude CV score on the CV row. /api/cv/score returns score_json
-- while score_text_hash (SHA-256 of raw_text) still matches, and re-scores
-- only when the CV text changes. Additive and nullable: existing CVs are
-- scored once on their next My CV visit.
ALTER TABLE "CV" ADD COLUMN "score_json" JSONB;
ALTER TABLE "CV" ADD COLUMN "score_text_hash" TEXT;
