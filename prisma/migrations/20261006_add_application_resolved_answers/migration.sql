-- Claude answers to open-ended application questions, cached per application
-- for the extension's form filling (/api/apply/resolve-answers), so reloading
-- an application form doesn't call Claude again.
ALTER TABLE "Application" ADD COLUMN "resolved_answers" JSONB;
