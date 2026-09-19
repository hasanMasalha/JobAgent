import DodoPayments from "dodopayments";

// `environment` is a narrow union ("test_mode" | "live_mode"), but
// process.env.X is `string | undefined` — narrow explicitly rather than
// casting, and default to test_mode so a missing or misspelled env var can
// never silently start charging real cards.
function resolveEnvironment(): "test_mode" | "live_mode" {
  return process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode";
}

let client: DodoPayments | null = null;

/**
 * Lazily builds the Dodo client on first use. It must not be constructed at
 * import time: `next build` evaluates route modules to collect page data, and
 * the API key is only injected at runtime (EC2 .env), so an eager client
 * would fail the build. Returns null when the key is missing so callers can
 * respond with a clear error instead of throwing.
 */
export function getDodo(): DodoPayments | null {
  const bearerToken = process.env.DODO_PAYMENTS_API_KEY;
  if (!bearerToken) return null;

  if (!client) {
    client = new DodoPayments({
      bearerToken,
      webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
      environment: resolveEnvironment(),
    });
  }
  return client;
}
