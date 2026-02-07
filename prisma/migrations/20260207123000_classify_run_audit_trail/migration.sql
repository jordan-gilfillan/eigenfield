-- Add auditable lifecycle + partial progress fields to classify_runs
ALTER TABLE "classify_runs"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'running',
  ADD COLUMN "skippedBadOutput" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "aliasedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "errorJson" JSONB,
  ADD COLUMN "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "finishedAt" TIMESTAMP(3);

-- Backfill existing historical rows as successful completed runs
UPDATE "classify_runs"
SET
  "status" = 'succeeded',
  "startedAt" = "createdAt",
  "finishedAt" = "createdAt"
WHERE "status" = 'running';
