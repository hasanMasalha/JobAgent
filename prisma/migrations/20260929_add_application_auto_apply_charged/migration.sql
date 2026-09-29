-- Tracks whether an application holds one of the user's monthly auto-apply
-- credits, so a failed submission (quick apply, or an extension apply that
-- reports manual/failed) refunds exactly once. Additive; existing rows are
-- uncharged, which is correct — nothing was charged for them.
ALTER TABLE "Application" ADD COLUMN "auto_apply_charged" BOOLEAN NOT NULL DEFAULT false;
