ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "plan"                 TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS "paddleCustomerId"     TEXT,
  ADD COLUMN IF NOT EXISTS "paddleSubscriptionId" TEXT,
  ADD COLUMN IF NOT EXISTS "planExpiresAt"        TIMESTAMP;
