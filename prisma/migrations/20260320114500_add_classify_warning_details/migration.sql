-- Add durable, non-sensitive classify warning diagnostics
ALTER TABLE "classify_runs"
  ADD COLUMN IF NOT EXISTS "warningDetailsJson" JSONB;
