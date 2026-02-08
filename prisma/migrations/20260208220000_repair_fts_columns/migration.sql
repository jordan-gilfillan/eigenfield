-- Repair migration for environments where AUD-001 FTS migration was marked as
-- applied but generated columns were not present.
ALTER TABLE "message_atoms"
  ADD COLUMN IF NOT EXISTS "text_search" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED;

CREATE INDEX IF NOT EXISTS "message_atoms_text_search_idx"
  ON "message_atoms" USING GIN ("text_search");

ALTER TABLE "outputs"
  ADD COLUMN IF NOT EXISTS "output_text_search" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "outputText")) STORED;

CREATE INDEX IF NOT EXISTS "outputs_output_text_search_idx"
  ON "outputs" USING GIN ("output_text_search");
