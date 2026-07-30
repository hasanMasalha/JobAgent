"use client";

import { initializePaddle, type Paddle } from "@paddle/paddle-js";

let paddleInstance: Paddle | undefined;
let paddlePromise: Promise<Paddle | undefined> | null = null;

// Paddle.js only runs in the browser and is expensive to (re)initialize, so cache
// the instance/in-flight promise across every checkout button on the page.
export function getPaddleClient(): Promise<Paddle | undefined> {
  if (paddleInstance) return Promise.resolve(paddleInstance);
  if (!paddlePromise) {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) {
      console.error("[paddle] NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not set");
      return Promise.resolve(undefined);
    }
    paddlePromise = initializePaddle({
      environment: process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
      token,
    }).then((instance) => {
      paddleInstance = instance;
      return instance;
    });
  }
  return paddlePromise;
}

export async function openPaddleCheckout(params: {
  priceId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  userId: string;
  plan: string;
  interval: string;
  successUrl: string;
}): Promise<void> {
  const paddle = await getPaddleClient();
  if (!paddle) throw new Error("Paddle failed to load. Please try again.");

  const customer = params.customerId
    ? { id: params.customerId }
    : params.customerEmail
    ? { email: params.customerEmail }
    : undefined;

  paddle.Checkout.open({
    items: [{ priceId: params.priceId, quantity: 1 }],
    customer,
    customData: { userId: params.userId, plan: params.plan, interval: params.interval },
    settings: { successUrl: params.successUrl },
  });
}
