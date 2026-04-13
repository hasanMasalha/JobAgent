import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

interface JobMatch {
  title: string;
  company: string;
  location: string;
  score: number;
  url: string;
}

export async function sendDailyMatchEmail(params: {
  userEmail: string;
  userName: string;
  matchCount: number;
  topMatches: JobMatch[];
}) {
  const { userEmail, userName, matchCount, topMatches } = params;
  const firstName = userName?.split(" ")[0] || "there";

  const jobRows = topMatches
    .slice(0, 5)
    .map(
      (job) => `
    <tr>
      <td style="padding:10px 0; border-bottom:1px solid #f3f4f6;">
        <a href="${job.url}"
           style="font-weight:600; color:#1d4ed8; text-decoration:none; font-size:14px;">
          ${job.title}
        </a>
        <div style="color:#6b7280; font-size:12px; margin-top:2px;">
          ${job.company} · ${job.location}
        </div>
      </td>
      <td style="padding:10px 0; border-bottom:1px solid #f3f4f6;
                 text-align:right; vertical-align:top;">
        <span style="
          background:${job.score >= 80 ? "#dcfce7" : job.score >= 65 ? "#fef9c3" : "#f3f4f6"};
          color:${job.score >= 80 ? "#166534" : job.score >= 65 ? "#854d0e" : "#374151"};
          padding:2px 8px; border-radius:20px; font-size:12px; font-weight:600;">
          ${job.score}% match
        </span>
      </td>
    </tr>
  `
    )
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body style="margin:0; padding:0; background:#f9fafb; font-family:Arial,sans-serif;">
      <div style="max-width:560px; margin:40px auto; background:white;
                  border-radius:12px; overflow:hidden;
                  box-shadow:0 1px 3px rgba(0,0,0,0.1);">

        <!-- Header -->
        <div style="background:#1d4ed8; padding:28px 32px;">
          <div style="color:white; font-size:20px; font-weight:700;">JobAgent</div>
          <div style="color:#bfdbfe; font-size:13px; margin-top:4px;">Your daily job matches</div>
        </div>

        <!-- Body -->
        <div style="padding:32px;">
          <p style="margin:0 0 8px; color:#111827; font-size:16px; font-weight:600;">
            Hi ${firstName} 👋
          </p>
          <p style="margin:0 0 24px; color:#6b7280; font-size:14px; line-height:1.6;">
            You have <strong style="color:#1d4ed8;">${matchCount} new job matches</strong>
            today based on your CV. Here are your top picks:
          </p>

          <table style="width:100%; border-collapse:collapse;">
            ${jobRows}
          </table>

          ${
            matchCount > 5
              ? `<p style="margin:16px 0 0; color:#6b7280; font-size:13px; text-align:center;">
              + ${matchCount - 5} more matches waiting for you
            </p>`
              : ""
          }

          <div style="text-align:center; margin:28px 0 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard"
               style="display:inline-block; background:#1d4ed8; color:white;
                      padding:12px 28px; border-radius:8px; text-decoration:none;
                      font-weight:600; font-size:14px;">
              View all matches →
            </a>
          </div>
        </div>

        <!-- Footer -->
        <div style="padding:20px 32px; background:#f9fafb;
                    border-top:1px solid #f3f4f6; text-align:center;">
          <p style="margin:0; color:#9ca3af; font-size:12px;">
            JobAgent · Sent daily when new matches are found
          </p>
          <p style="margin:6px 0 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/profile?unsubscribe=true"
               style="color:#9ca3af; font-size:12px;">
              Unsubscribe from daily emails
            </a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  await resend.emails.send({
    from: "JobAgent <onboarding@resend.dev>",
    to: userEmail,
    subject: `${matchCount} new job matches today`,
    html,
  });
}
