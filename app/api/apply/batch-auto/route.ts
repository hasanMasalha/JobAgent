import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { db } from "@/lib/db";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function generateEmailHtml(params: {
  userName: string;
  jobTitle: string;
  company: string;
  cvSummary: string;
}): string {
  return `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <p>Dear Hiring Team at ${params.company},</p>
  <p>I am writing to express my interest in the <strong>${params.jobTitle}</strong> position.</p>
  <p>${params.cvSummary}</p>
  <p>I would welcome the opportunity to discuss how my background aligns with your needs.</p>
  <p>Best regards,<br/>${params.userName}</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
  <p style="font-size:11px;color:#999">Sent via JobAgent</p>
</div>`.trim();
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobIds } = await req.json() as { jobIds: string[] };
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json({ error: "jobIds array required" }, { status: 400 });
    }

    const [jobs, profile, cvRows] = await Promise.all([
      db.job.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, title: true, company: true, url: true, recruiter_email: true },
      }),
      db.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } }),
      db.$queryRaw<{ clean_summary: string | null }[]>`
        SELECT clean_summary FROM "CV" WHERE user_id = ${user.id} LIMIT 1
      `,
    ]);

    const userName = profile?.name ?? "Applicant";
    const cvSummary = cvRows[0]?.clean_summary ?? "I have relevant experience for this role.";
    const results: { jobId: string; status: string }[] = [];
    let emailCount = 0;

    for (const job of jobs) {
      if (!job.recruiter_email) {
        results.push({ jobId: job.id, status: "skipped_no_email" });
        continue;
      }

      try {
        await resend.emails.send({
          from: "applications@jobagent.uk",
          to: job.recruiter_email,
          subject: `Application for ${job.title} — ${userName}`,
          html: generateEmailHtml({ userName, jobTitle: job.title, company: job.company, cvSummary }),
        });

        await db.application.create({
          data: { user_id: user.id, job_id: job.id, status: "applied" },
        });

        results.push({ jobId: job.id, status: "sent" });
        emailCount++;
      } catch (e) {
        console.error("[batch-auto] email failed for job", job.id, e);
        results.push({ jobId: job.id, status: "failed" });
      }
    }

    return NextResponse.json({ success: true, count: emailCount, results });
  } catch (err) {
    console.error("[batch-auto]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
