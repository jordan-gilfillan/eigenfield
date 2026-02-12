-- Ensure classify prompt metadata exists even if seed is skipped in production.
-- This migration is intentionally idempotent and only touches CLASSIFY defaults.

DO $$
DECLARE
  classify_prompt_id TEXT;
BEGIN
  INSERT INTO "prompts" ("id", "stage", "name", "createdAt")
  VALUES (
    'mig_' || md5(random()::text || clock_timestamp()::text),
    'CLASSIFY',
    'default-classifier',
    NOW()
  )
  ON CONFLICT ("stage", "name") DO UPDATE
    SET "name" = EXCLUDED."name"
  RETURNING "id" INTO classify_prompt_id;

  INSERT INTO "prompt_versions" (
    "id",
    "promptId",
    "versionLabel",
    "templateText",
    "createdAt",
    "isActive"
  )
  VALUES (
    'mig_' || md5(random()::text || clock_timestamp()::text),
    classify_prompt_id,
    'classify_stub_v1',
    'STUB: Deterministic classification based on atomStableId hash. See spec 7.2.',
    NOW(),
    FALSE
  )
  ON CONFLICT ("promptId", "versionLabel") DO UPDATE
    SET
      "templateText" = EXCLUDED."templateText",
      "isActive" = FALSE;

  INSERT INTO "prompt_versions" (
    "id",
    "promptId",
    "versionLabel",
    "templateText",
    "createdAt",
    "isActive"
  )
  VALUES (
    'mig_' || md5(random()::text || clock_timestamp()::text),
    classify_prompt_id,
    'classify_real_v1',
    $$You are a message classifier. Classify the following AI conversation message into exactly one category.

Categories: WORK, LEARNING, CREATIVE, MUNDANE, PERSONAL, OTHER, MEDICAL, MENTAL_HEALTH, ADDICTION_RECOVERY, INTIMACY, FINANCIAL, LEGAL, EMBARRASSING

Return ONLY a JSON object. No prose. No code fences.
Example output:
{"category":"WORK","confidence":0.72}

Rules:
- category MUST be one of the listed categories (uppercase, exact match)
- confidence MUST be a number between 0.0 and 1.0
- Never invent new categories. If uncertain, choose the closest category from the allowed list.
- Do NOT include any explanation or text outside the JSON object$$,
    NOW(),
    FALSE
  )
  ON CONFLICT ("promptId", "versionLabel") DO UPDATE
    SET "templateText" = EXCLUDED."templateText";

  -- If no active non-stub classify prompt exists, activate classify_real_v1.
  IF NOT EXISTS (
    SELECT 1
    FROM "prompt_versions" pv
    WHERE pv."promptId" = classify_prompt_id
      AND pv."isActive" = TRUE
      AND pv."versionLabel" NOT ILIKE '%stub%'
  ) THEN
    UPDATE "prompt_versions"
    SET "isActive" = TRUE
    WHERE "promptId" = classify_prompt_id
      AND "versionLabel" = 'classify_real_v1';
  END IF;
END $$;
