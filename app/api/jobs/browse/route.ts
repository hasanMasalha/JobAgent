import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

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
        },
        orderBy: { scraped_at: "desc" },
        take: limit,
        skip: (page - 1) * limit,
      }),
      db.job.count({ where }),
    ]);

    return NextResponse.json({
      jobs: jobs.map((j) => ({ ...j, description: j.description?.slice(0, 300) ?? "" })),
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
