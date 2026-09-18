-- Paddle rejected our account; replacing it with Dodo Payments as the
-- merchant of record. Rename rather than drop+add so any billing state
-- already written to these columns is preserved.
ALTER TABLE "User" RENAME COLUMN "paddleCustomerId" TO "dodoCustomerId";
ALTER TABLE "User" RENAME COLUMN "paddleSubscriptionId" TO "dodoSubscriptionId";
