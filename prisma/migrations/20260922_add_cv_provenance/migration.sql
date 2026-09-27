-- Tracks whether CV.raw_text is the user's own uploaded content or
-- AI-authored, and stores the original uploaded file bytes so an uploaded
-- CV can be sent byte-for-byte wherever a CV file is attached/submitted,
-- instead of being re-rendered from extracted text.
ALTER TABLE "CV" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'uploaded';
ALTER TABLE "CV" ADD COLUMN "original_file" BYTEA;
ALTER TABLE "CV" ADD COLUMN "original_filename" TEXT;
ALTER TABLE "CV" ADD COLUMN "original_mime_type" TEXT;
