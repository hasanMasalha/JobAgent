CREATE TABLE IF NOT EXISTS "daily_match_usage" (
  "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "date"    TIMESTAMP NOT NULL,
  "job_ids" JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY ("user_id", "date")
);
