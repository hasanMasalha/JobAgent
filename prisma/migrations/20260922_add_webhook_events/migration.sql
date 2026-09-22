-- Idempotency claim table for Dodo webhook deliveries. A webhook-id is
-- claimed (unique constraint) before any side effect that a Dodo retry
-- must not repeat, such as the plan/cancellation confirmation emails.
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_events_webhookId_key" ON "webhook_events"("webhookId");
