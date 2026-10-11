-- Batch email auto-apply (/api/apply/batch-auto) was its only reader and the
-- admin backfill its only writer; both were removed. Null on every row.
-- Apply only after the code that no longer selects it is deployed.
ALTER TABLE "Job" DROP COLUMN "recruiter_email";
