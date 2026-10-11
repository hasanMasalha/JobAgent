-- The required questions an application stopped on because the user hadn't
-- answered them ([{question, options}]), written by the AI service with
-- needs_manual. The Applications page asks each one and saves the answer for
-- that exact question (EasyApplyAnswer). Null for any other outcome.
-- Additive: apply before deploying the code that writes it.
ALTER TABLE "Application" ADD COLUMN "missing_questions" JSONB;
