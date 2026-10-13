-- Expected salary as amount, currency and period (ai-service/salary.py),
-- replacing the free-text "Expected salary (monthly, NIS)".
ALTER TABLE "User" ADD COLUMN "salary_amount" INTEGER;
ALTER TABLE "User" ADD COLUMN "salary_currency" TEXT;
ALTER TABLE "User" ADD COLUMN "salary_period" TEXT;
ALTER TABLE "User" ADD COLUMN "salary_convert_currency" BOOLEAN NOT NULL DEFAULT false;

-- The old field was asked as monthly NIS. Only a plain number ("20000",
-- "20,000") is copied; anything else ("20k-25k", "negotiable") is left for
-- the user to enter again. expected_salary is kept, unread, for now.
UPDATE "User"
SET "salary_amount" = replace(trim("expected_salary"), ',', '')::INTEGER,
    "salary_currency" = 'ILS',
    "salary_period" = 'month'
WHERE trim("expected_salary") ~ '^([1-9][0-9]{0,2}(,[0-9]{3}){1,2}|[1-9][0-9]{0,8})$';

-- ECB daily reference rates (ai-service/exchange_rates.py).
CREATE TABLE "ExchangeRate" (
    "currency" TEXT NOT NULL,
    "per_eur" DOUBLE PRECISION NOT NULL,
    "rate_date" DATE NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("currency")
);
