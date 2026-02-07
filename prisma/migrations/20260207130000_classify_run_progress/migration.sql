-- Add classify progress checkpoint fields
ALTER TABLE "classify_runs"
  ADD COLUMN "processedAtoms" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAtomStableIdProcessed" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill historical rows: completed rows are fully processed, running rows remain at 0
UPDATE "classify_runs"
SET
  "processedAtoms" = CASE WHEN "status" = 'running' THEN 0 ELSE "totalAtoms" END,
  "updatedAt" = COALESCE("finishedAt", "createdAt");
