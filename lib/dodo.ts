import DodoPayments from "dodopayments";

// `environment` is a narrow union ("test_mode" | "live_mode"), but
// process.env.X is `string | undefined` — narrow explicitly rather than
// casting, and default to test_mode so a missing or misspelled env var can
// never silently start charging real cards.
const environment = process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode";

export const dodo = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
  environment,
});
