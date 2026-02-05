-- Add Postgres Full-Text Search support for MessageAtom.text and Output.outputText
-- Spec reference: 10.1 (lexical search via tsvector)

-- MessageAtom: add generated tsvector column + GIN index
ALTER TABLE "message_atoms"
  ADD COLUMN "text_search" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED;

CREATE INDEX "message_atoms_text_search_idx"
  ON "message_atoms" USING GIN ("text_search");

-- Output: add generated tsvector column + GIN index
ALTER TABLE "outputs"
  ADD COLUMN "output_text_search" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "outputText")) STORED;

CREATE INDEX "outputs_output_text_search_idx"
  ON "outputs" USING GIN ("output_text_search");
