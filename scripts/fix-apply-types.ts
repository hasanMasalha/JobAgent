// One-time backfill: re-detect apply_type and recruiter_email for all jobs.
// Run with: npx ts-node --project tsconfig.json scripts/fix-apply-types.ts
// OR expose via the admin API endpoint at /api/admin/fix-apply-types

import { PrismaClient } from "@prisma/client";
import { detectApplyType, extractRecruiterEmail } from "../lib/detect-apply-type";

const db = new PrismaClient();

async function main() {
  const jobs = await db.job.findMany({
    select: { id: true, url: true, source: true, description: true, apply_type: true },
  });

  console.log(`Processing ${jobs.length} jobs…`);
  let fixed = 0;

  for (const job of jobs) {
    const applyType = detectApplyType({
      url: job.url ?? "",
      source: job.source ?? "",
      description: job.description ?? "",
    });
    const email = extractRecruiterEmail(job.description ?? "");

    if (applyType !== job.apply_type || email) {
      await db.job.update({
        where: { id: job.id },
        data: { apply_type: applyType, recruiter_email: email ?? undefined },
      });
      fixed++;
    }
  }

  console.log(`Done — updated ${fixed} of ${jobs.length} jobs.`);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
