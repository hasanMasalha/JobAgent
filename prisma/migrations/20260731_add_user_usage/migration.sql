DROP TABLE IF EXISTS "daily_match_usage";

CREATE TABLE IF NOT EXISTS "UserUsage" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT UNIQUE NOT NULL,
  "jobMatchesToday" INTEGER DEFAULT 0,
  "matchesResetAt" TIMESTAMP DEFAULT NOW(),
  "autoAppliesThisMonth" INTEGER DEFAULT 0,
  "cvTailoringThisMonth" INTEGER DEFAULT 0,
  "appliancesResetAt" TIMESTAMP DEFAULT NOW(),
  "totalAutoApplies" INTEGER DEFAULT 0,
  "totalCvTailoring" INTEGER DEFAULT 0,
  "totalJobsViewed" INTEGER DEFAULT 0,
  "updatedAt" TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE
);
