import { NextRequest } from "next/server";

// Mock Prisma before importing the route
jest.mock("@/lib/db", () => ({
  db: {
    job: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

import { GET } from "@/app/api/jobs/browse/route";
import { db } from "@/lib/db";

const mockFindMany = db.job.findMany as jest.Mock;
const mockCount = db.job.count as jest.Mock;

const SAMPLE_JOB = {
  id: "job-1",
  title: "Backend Developer",
  company: "Wix",
  location: "Tel Aviv",
  url: "https://wix.com/jobs/1",
  source: "linkedin",
  salary_min: null,
  salary_max: null,
  scraped_at: new Date("2026-05-01T00:00:00Z"),
  description: "Build great software.",
};

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/jobs/browse");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

beforeEach(() => {
  mockFindMany.mockResolvedValue([SAMPLE_JOB]);
  mockCount.mockResolvedValue(1);
});

afterEach(() => {
  jest.clearAllMocks();
});

test("GET /api/jobs/browse returns 200", async () => {
  const res = await GET(makeRequest());
  expect(res.status).toBe(200);
});

test("response contains jobs array and total fields", async () => {
  const res = await GET(makeRequest());
  const body = await res.json();

  expect(Array.isArray(body.jobs)).toBe(true);
  expect(typeof body.total).toBe("number");
  expect(typeof body.page).toBe("number");
  expect(typeof body.total_pages).toBe("number");
});

test("pagination params are forwarded to Prisma", async () => {
  await GET(makeRequest({ page: "2", limit: "5" }));

  expect(mockFindMany).toHaveBeenCalledWith(
    expect.objectContaining({ take: 5, skip: 5 })
  );
});
