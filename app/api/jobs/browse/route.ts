import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { detectApplyType, extractRecruiterEmail } from "@/lib/detect-apply-type";

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 50;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const search = sp.get("search")?.trim() ?? "";
  const location = sp.get("location")?.trim() ?? "";
  const company = sp.get("company")?.trim() ?? "";
  const source = sp.get("source")?.trim() ?? "";
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const limit = Math.min(LIMIT_MAX, Math.max(1, Number(sp.get("limit") ?? LIMIT_DEFAULT)));

  const where = {
    AND: [
      // Exclude jobs explicitly marked inactive (stale / expired)
      { is_active: { not: false } },
      ...(search
        ? [
            {
              OR: [
                { title: { contains: search, mode: "insensitive" as const } },
                { company: { contains: search, mode: "insensitive" as const } },
                { description: { contains: search, mode: "insensitive" as const } },
              ],
            },
          ]
        : []),
      ...(location ? [{ location: { contains: location, mode: "insensitive" as const } }] : []),
      ...(company ? [{ company: { contains: company, mode: "insensitive" as const } }] : []),
      ...(source ? [{ source }] : []),
    ],
  };

  try {
    const dbTotal = await db.job.count();
    console.log("[browse] total jobs in DB:", dbTotal);

    const [jobs, total] = await Promise.all([
      db.job.findMany({
        where,
        select: {
          id: true,
          title: true,
          company: true,
          location: true,
          url: true,
          source: true,
          salary_min: true,
          salary_max: true,
          scraped_at: true,
          description: true,
          apply_type: true,
          recruiter_email: true,
          is_active: true,
        },
        orderBy: { scraped_at: "desc" },
        take: limit,
        skip: (page - 1) * limit,
      }),
      db.job.count({ where }),
    ]);

    console.log("[browse] filtered jobs:", total);

    return NextResponse.json({
      jobs: jobs.map((j: (typeof jobs)[number]) => ({
        ...j,
        description: j.description ?? "",
        apply_type: j.apply_type ?? detectApplyType({ url: j.url, source: j.source, description: j.description ?? "" }),
        recruiter_email: j.recruiter_email ?? extractRecruiterEmail(j.description ?? ""),
      })),
      total,
      page,
      total_pages: Math.ceil(total / limit),
      limit,
    });
  } catch (err) {
    console.error("[browse]", err);
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
  }
}
