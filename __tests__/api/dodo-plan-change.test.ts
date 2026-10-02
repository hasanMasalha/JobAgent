import DodoPayments from "dodopayments";
import { NextRequest } from "next/server";

// An accepted changePlan request is not a changed plan: with
// on_payment_failure: prevent_change Dodo keeps the old plan when the prorated
// charge fails. /api/dodo/checkout hands back the payment id, and
// /api/dodo/plan-change-status reports what Dodo actually did — it must never
// say "applied" unless the subscription is on the target product.

jest.mock("@/lib/supabase.server", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
}));

jest.mock("@/lib/db", () => ({
  db: { user: { findUnique: jest.fn(), update: jest.fn() } },
}));

const retrieveSub = jest.fn();
const changePlan = jest.fn();
const retrievePayment = jest.fn();
jest.mock("@/lib/dodo", () => ({
  getDodo: () => ({
    subscriptions: { retrieve: retrieveSub, changePlan },
    payments: { retrieve: retrievePayment },
  }),
}));

import { db } from "@/lib/db";
import { POST as checkout } from "@/app/api/dodo/checkout/route";
import { GET as status } from "@/app/api/dodo/plan-change-status/route";

const mdb = db as unknown as { user: { findUnique: jest.Mock; update: jest.Mock } };

const SUB = { subscription_id: "sub_1", product_id: "pdt_pro_m", status: "active", scheduled_change: null };

const getStatus = (query = "plan=unlimited&interval=monthly&paymentId=pay_1") =>
  status(new NextRequest(`http://localhost/api/dodo/plan-change-status?${query}`));
const postCheckout = (body: unknown) =>
  checkout(new NextRequest("http://localhost/api/dodo/checkout", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  process.env.DODO_PRO_MONTHLY_PRODUCT_ID = "pdt_pro_m";
  process.env.DODO_PRO_ANNUAL_PRODUCT_ID = "pdt_pro_a";
  process.env.DODO_UNLIMITED_MONTHLY_PRODUCT_ID = "pdt_unl_m";
  process.env.DODO_UNLIMITED_ANNUAL_PRODUCT_ID = "pdt_unl_a";
  mdb.user.findUnique.mockResolvedValue({ email: "a@b.c", name: "A", dodoCustomerId: "cus_1", plan: "pro", dodoSubscriptionId: "sub_1" });
  retrieveSub.mockResolvedValue(SUB);
});

describe("GET /api/dodo/plan-change-status", () => {
  it("is applied once the subscription is on the target product", async () => {
    retrieveSub.mockResolvedValue({ ...SUB, product_id: "pdt_unl_m" });
    const res = await getStatus();
    expect(await res.json()).toEqual({ status: "applied" });
    expect(retrievePayment).not.toHaveBeenCalled();
  });

  it("is pending while the payment is processing", async () => {
    retrievePayment.mockResolvedValue({ subscription_id: "sub_1", status: "processing" });
    expect(await (await getStatus()).json()).toMatchObject({ status: "pending" });
  });

  it("stays pending after the payment succeeds until the product actually changes", async () => {
    retrievePayment.mockResolvedValue({ subscription_id: "sub_1", status: "succeeded" });
    expect(await (await getStatus()).json()).toMatchObject({ status: "pending" });
  });

  it("is failed with Dodo's reason when the payment failed", async () => {
    retrievePayment.mockResolvedValue({ subscription_id: "sub_1", status: "failed", error_code: "X", error_message: "Card declined." });
    expect(await (await getStatus()).json()).toEqual({ status: "failed", reason: "Card declined." });
  });

  it("is failed when the subscription is on hold, even with no payment id", async () => {
    retrieveSub.mockResolvedValue({ ...SUB, status: "on_hold" });
    expect(await (await getStatus("plan=unlimited&interval=monthly")).json()).toEqual({ status: "failed", reason: null });
  });

  it("reports a scheduled change as pending", async () => {
    retrieveSub.mockResolvedValue({ ...SUB, scheduled_change: { product_id: "pdt_unl_m" } });
    expect(await (await getStatus("plan=unlimited&interval=monthly")).json()).toEqual({ status: "pending", scheduled: true });
  });

  it("won't report on a payment that belongs to another subscription", async () => {
    retrievePayment.mockResolvedValue({ subscription_id: "sub_other", status: "failed", error_message: "Someone else's decline" });
    const res = await getStatus();
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("Someone else");
  });

  it("looks the subscription up from the user's own row and writes nothing", async () => {
    retrievePayment.mockResolvedValue({ subscription_id: "sub_1", status: "processing" });
    await getStatus();
    expect(retrieveSub).toHaveBeenCalledWith("sub_1");
    expect(mdb.user.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown plan", async () => {
    expect((await getStatus("plan=free&interval=monthly")).status).toBe(400);
  });
});

describe("POST /api/dodo/checkout for an existing subscriber", () => {
  it("returns the payment id of the plan-change charge", async () => {
    changePlan.mockResolvedValue({ payment_id: "pay_1" });
    const res = await postCheckout({ plan: "unlimited", interval: "monthly" });
    expect(await res.json()).toEqual({ changed: true, effective: "immediately", paymentId: "pay_1" });
    expect(changePlan).toHaveBeenCalledWith("sub_1", expect.objectContaining({ product_id: "pdt_unl_m", on_payment_failure: "prevent_change" }));
  });

  it("returns a null payment id when Dodo made no charge", async () => {
    changePlan.mockResolvedValue({});
    const res = await postCheckout({ plan: "unlimited", interval: "monthly" });
    expect(await res.json()).toMatchObject({ changed: true, paymentId: null });
  });

  it("turns Dodo's 409 into a clear message instead of a 500", async () => {
    changePlan.mockRejectedValue(new DodoPayments.ConflictError(409, {}, "Conflict", new Headers()));
    const res = await postCheckout({ plan: "unlimited", interval: "monthly" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already pending or scheduled/);
  });

  it("still returns 500 for other Dodo errors", async () => {
    changePlan.mockRejectedValue(new Error("boom"));
    expect((await postCheckout({ plan: "unlimited", interval: "monthly" })).status).toBe(500);
  });
});
