DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PromptDefaultSlot') THEN
    CREATE TYPE "PromptDefaultSlot" AS ENUM ('CLASSIFY_STUB', 'CLASSIFY_REAL', 'SUMMARIZE', 'REDACT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "prompt_defaults" (
  "slot" "PromptDefaultSlot" NOT NULL,
  "promptId" TEXT NOT NULL,
  "promptVersionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "prompt_defaults_pkey" PRIMARY KEY ("slot")
);

CREATE INDEX IF NOT EXISTS "prompt_defaults_promptId_idx" ON "prompt_defaults"("promptId");
CREATE INDEX IF NOT EXISTS "prompt_defaults_promptVersionId_idx" ON "prompt_defaults"("promptVersionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prompt_defaults_promptId_fkey'
  ) THEN
    ALTER TABLE "prompt_defaults"
      ADD CONSTRAINT "prompt_defaults_promptId_fkey"
      FOREIGN KEY ("promptId") REFERENCES "prompts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prompt_defaults_promptVersionId_fkey'
  ) THEN
    ALTER TABLE "prompt_defaults"
      ADD CONSTRAINT "prompt_defaults_promptVersionId_fkey"
      FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "prompt_defaults" ("slot", "promptId", "promptVersionId")
SELECT 'CLASSIFY_STUB', p.id, pv.id
FROM "prompts" p
JOIN "prompt_versions" pv ON pv."promptId" = p.id
WHERE p."stage" = 'CLASSIFY'
  AND p."name" = 'default-classifier'
  AND pv."versionLabel" = 'classify_stub_v1'
ON CONFLICT ("slot") DO UPDATE
SET
  "promptId" = EXCLUDED."promptId",
  "promptVersionId" = EXCLUDED."promptVersionId",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "prompt_defaults" ("slot", "promptId", "promptVersionId")
SELECT 'CLASSIFY_REAL', p.id, pv.id
FROM "prompts" p
JOIN "prompt_versions" pv ON pv."promptId" = p.id
WHERE p."stage" = 'CLASSIFY'
  AND p."name" = 'default-classifier'
  AND pv."versionLabel" = 'classify_real_v1'
ON CONFLICT ("slot") DO UPDATE
SET
  "promptId" = EXCLUDED."promptId",
  "promptVersionId" = EXCLUDED."promptVersionId",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "prompt_defaults" ("slot", "promptId", "promptVersionId")
SELECT 'SUMMARIZE', p.id, pv.id
FROM "prompts" p
JOIN "prompt_versions" pv ON pv."promptId" = p.id
WHERE p."stage" = 'SUMMARIZE'
  AND p."name" = 'default-summarizer'
  AND pv."versionLabel" = 'v1'
ON CONFLICT ("slot") DO UPDATE
SET
  "promptId" = EXCLUDED."promptId",
  "promptVersionId" = EXCLUDED."promptVersionId",
  "updatedAt" = CURRENT_TIMESTAMP;
