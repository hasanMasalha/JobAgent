import { Paddle, Environment } from "@paddle/paddle-node-sdk";

export const paddle = new Paddle(process.env.PADDLE_API_KEY!, {
  environment: process.env.PADDLE_ENVIRONMENT === "sandbox" ? Environment.sandbox : Environment.production,
});
