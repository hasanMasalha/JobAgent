ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "google_access_token"  TEXT,
  ADD COLUMN IF NOT EXISTS "google_refresh_token" TEXT,
  ADD COLUMN IF NOT EXISTS "google_connected"     BOOLEAN NOT NULL DEFAULT false;
