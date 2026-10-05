import { NextRequest } from "next/server";

// Profile's phone must name its country: application forms ask for the
// phone's country and the AI service takes it from the number.

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));
jest.mock("@/lib/db", () => ({
  db: { user: { update: jest.fn(), findUnique: jest.fn() } },
}));

import { db } from "@/lib/db";
import { PATCH } from "@/app/api/profile/route";

const update = (db as unknown as { user: { update: jest.Mock } }).user.update;
const patch = (body: unknown) =>
  new NextRequest("http://localhost/api/profile", { method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  update.mockResolvedValue({});
});

describe("PATCH /api/profile phone", () => {
  it("rejects a number without a country code and saves nothing", async () => {
    const res = await PATCH(patch({ phone: "07400 123456", city: "London" }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid_phone");
    expect(data.message).toMatch(/country code/);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([["+44 7400 123456"], ["050-1234567"], [""]])("saves %p", async (phone) => {
    const res = await PATCH(patch({ phone }));
    expect(res.status).not.toBe(400);
    expect(update).toHaveBeenCalled();
  });

  it("doesn't check a request that doesn't change the phone", async () => {
    const res = await PATCH(patch({ city: "London" }));
    expect(res.status).not.toBe(400);
  });
});
