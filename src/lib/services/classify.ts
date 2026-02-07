/**
 * Classification Service
 *
 * Handles classification of MessageAtoms.
 * Supports stub mode (deterministic) and real mode (LLM-based via callLlm).
 *
 * Spec references: 7.2 (Classify), 6.3 (MessageLabel), 6.4 (Category)
 */

import { prisma } from '../db'
import { sha256, hashToUint32 } from '../hash'
import type { Category } from '@prisma/client'
import {
  callLlm,
  inferProvider,
  getMinDelayMs,
  getSpendCaps,
  assertWithinBudget,
  RateLimiter,
  LlmBadOutputError,
  BudgetExceededError,
} from '../llm'
import type { ProviderId, LlmCallContext } from '../llm'

/**
 * Thrown when classify request parameters are invalid per spec 7.2 guardrails.
 * The route handler maps this to HTTP 400 with code INVALID_INPUT.
 */
export class InvalidInputError extends Error {
  readonly code = 'INVALID_INPUT'
  readonly details?: Record<string, unknown>

  constructor(message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'InvalidInputError'
    this.details = details
  }
}

/**
 * Core categories in the exact order required by stub_v1 algorithm (spec 7.2)
 */
const STUB_CATEGORIES: Category[] = [
  'WORK',
  'LEARNING',
  'CREATIVE',
  'MUNDANE',
  'PERSONAL',
  'OTHER',
]

/** All valid Category values from the Prisma enum (spec 6.4) */
const ALL_CATEGORIES: ReadonlySet<string> = new Set([
  'WORK', 'LEARNING', 'CREATIVE', 'MUNDANE', 'PERSONAL', 'OTHER',
  'MEDICAL', 'MENTAL_HEALTH', 'ADDICTION_RECOVERY', 'INTIMACY',
  'FINANCIAL', 'LEGAL', 'EMBARRASSING',
])

/** Batch size for processing to avoid Postgres bind variable limits */
const BATCH_SIZE = 10000

export interface ClassifyOptions {
  /** The import batch to classify */
  importBatchId: string
  /** Model string (for stub, must be "stub_v1") */
  model: string
  /** The prompt version ID to associate with labels */
  promptVersionId: string
  /** Classification mode */
  mode: 'stub' | 'real'
}

export interface ClassifyResult {
  importBatchId: string
  labelSpec: {
    model: string
    promptVersionId: string
  }
  mode: 'stub' | 'real'
  totals: {
    messageAtoms: number
    labeled: number
    newlyLabeled: number
    skippedAlreadyLabeled: number
  }
}

/**
 * Computes the stub category for a MessageAtom based on spec 7.2 stub_v1 algorithm.
 *
 * h = sha256(atomStableId)
 * index = uint32(h[0..3]) % 6
 * category = STUB_CATEGORIES[index]
 */
export function computeStubCategory(atomStableId: string): Category {
  const h = sha256(atomStableId)
  const index = hashToUint32(h) % STUB_CATEGORIES.length
  return STUB_CATEGORIES[index]
}

/**
 * Parses and validates LLM classification output.
 *
 * Expected format: {"category":"WORK","confidence":0.7}
 *
 * @throws LlmBadOutputError if output is invalid
 */
export function parseClassifyOutput(text: string): { category: Category; confidence: number } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    throw new LlmBadOutputError('LLM output is not valid JSON', { rawOutput: text })
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new LlmBadOutputError('LLM output is not a JSON object', { rawOutput: text })
  }

  const obj = parsed as Record<string, unknown>

  // Validate category
  if (typeof obj.category !== 'string') {
    throw new LlmBadOutputError('LLM output missing or invalid "category" field', { rawOutput: text })
  }
  const categoryUpper = obj.category.toUpperCase()
  if (!ALL_CATEGORIES.has(categoryUpper)) {
    throw new LlmBadOutputError(
      `LLM output has invalid category: "${obj.category}"`,
      { rawOutput: text, category: obj.category, validCategories: [...ALL_CATEGORIES] }
    )
  }

  // Validate confidence
  if (typeof obj.confidence !== 'number') {
    throw new LlmBadOutputError('LLM output missing or invalid "confidence" field', { rawOutput: text })
  }
  if (obj.confidence < 0 || obj.confidence > 1) {
    throw new LlmBadOutputError(
      `LLM output has confidence out of range [0, 1]: ${obj.confidence}`,
      { rawOutput: text, confidence: obj.confidence }
    )
  }

  return {
    category: categoryUpper as Category,
    confidence: obj.confidence,
  }
}

/**
 * Persists a ClassifyRun stats record for dashboard/run-detail retrieval.
 */
async function persistClassifyRun(result: ClassifyResult): Promise<void> {
  await prisma.classifyRun.create({
    data: {
      importBatchId: result.importBatchId,
      model: result.labelSpec.model,
      promptVersionId: result.labelSpec.promptVersionId,
      mode: result.mode,
      totalAtoms: result.totals.messageAtoms,
      newlyLabeled: result.totals.newlyLabeled,
      skippedAlreadyLabeled: result.totals.skippedAlreadyLabeled,
      labeledTotal: result.totals.labeled,
    },
  })
}

/**
 * Classifies all MessageAtoms in an ImportBatch.
 *
 * Label versioning rules (spec 6.3):
 * - MessageLabel uniqueness is (messageAtomId, promptVersionId, model)
 * - Classification is idempotent for the same labelSpec
 * - If a label already exists for an atom with the same (promptVersionId, model), skip it
 *
 * @throws Error if importBatchId not found
 * @throws Error if promptVersionId not found
 * @throws BudgetExceededError if budget cap exceeded during real mode
 * @throws LlmBadOutputError if LLM returns unparseable output
 */
export async function classifyBatch(options: ClassifyOptions): Promise<ClassifyResult> {
  const { importBatchId, model, promptVersionId, mode } = options

  // Verify import batch exists
  const importBatch = await prisma.importBatch.findUnique({
    where: { id: importBatchId },
  })
  if (!importBatch) {
    throw new Error(`ImportBatch not found: ${importBatchId}`)
  }

  // Verify prompt version exists (include parent Prompt for stage check)
  const promptVersion = await prisma.promptVersion.findUnique({
    where: { id: promptVersionId },
    include: { prompt: { select: { stage: true } } },
  })
  if (!promptVersion) {
    throw new Error(`PromptVersion not found: ${promptVersionId}`)
  }

  // ── Mode-aware PromptVersion guardrails (spec §6.7, §7.2) ──
  if (mode === 'real') {
    // Must belong to classify stage
    if (promptVersion.prompt.stage !== 'CLASSIFY') {
      throw new InvalidInputError(
        `PromptVersion stage must be CLASSIFY for classify, got ${promptVersion.prompt.stage}`,
        { promptVersionId, stage: promptVersion.prompt.stage }
      )
    }

    // Must NOT be the seeded stub prompt version
    if (promptVersion.versionLabel === 'classify_stub_v1') {
      throw new InvalidInputError(
        'mode="real" must not use classify_stub_v1 prompt version',
        { promptVersionId, versionLabel: promptVersion.versionLabel }
      )
    }

    // Template must be JSON-constraining (contains category+confidence markers)
    const t = promptVersion.templateText
    if (!t.includes('category') || !t.includes('confidence')) {
      throw new InvalidInputError(
        'mode="real" requires a JSON-constraining classify prompt (must reference "category" and "confidence")',
        { promptVersionId, versionLabel: promptVersion.versionLabel }
      )
    }
  }

  // Count total atoms for this batch
  const totalAtoms = await prisma.messageAtom.count({
    where: { importBatchId },
  })

  if (totalAtoms === 0) {
    const result: ClassifyResult = {
      importBatchId,
      labelSpec: { model, promptVersionId },
      mode,
      totals: {
        messageAtoms: 0,
        labeled: 0,
        newlyLabeled: 0,
        skippedAlreadyLabeled: 0,
      },
    }
    await persistClassifyRun(result)
    return result
  }

  // Count existing labels for this batch + labelSpec using a JOIN (no bind variable limit)
  const existingLabelCount = await prisma.messageLabel.count({
    where: {
      messageAtom: { importBatchId },
      promptVersionId,
      model,
    },
  })

  // If all atoms already labeled, skip processing
  if (existingLabelCount >= totalAtoms) {
    const result: ClassifyResult = {
      importBatchId,
      labelSpec: { model, promptVersionId },
      mode,
      totals: {
        messageAtoms: totalAtoms,
        labeled: existingLabelCount,
        newlyLabeled: 0,
        skippedAlreadyLabeled: totalAtoms,
      },
    }
    await persistClassifyRun(result)
    return result
  }

  // Dispatch to mode-specific implementation
  let result: ClassifyResult
  if (mode === 'stub') {
    result = await classifyBatchStub(importBatchId, model, promptVersionId, totalAtoms)
  } else {
    result = await classifyBatchReal(importBatchId, model, promptVersionId, totalAtoms, promptVersion.templateText)
  }

  await persistClassifyRun(result)
  return result
}

/**
 * Stub classification: deterministic categories based on atomStableId hash.
 */
async function classifyBatchStub(
  importBatchId: string,
  model: string,
  promptVersionId: string,
  totalAtoms: number,
): Promise<ClassifyResult> {
  let newlyLabeled = 0
  let cursor: string | undefined

  while (true) {
    const atomsBatch = await prisma.messageAtom.findMany({
      where: {
        importBatchId,
        messageLabels: {
          none: { promptVersionId, model },
        },
      },
      select: { id: true, atomStableId: true },
      take: BATCH_SIZE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { id: 'asc' },
    })

    if (atomsBatch.length === 0) break

    const labelsData = atomsBatch.map((atom) => ({
      messageAtomId: atom.id,
      category: computeStubCategory(atom.atomStableId),
      confidence: 0.5,
      model,
      promptVersionId,
    }))

    const result = await prisma.messageLabel.createMany({
      data: labelsData,
      skipDuplicates: true,
    })

    newlyLabeled += result.count
    cursor = atomsBatch[atomsBatch.length - 1].id

    if (atomsBatch.length < BATCH_SIZE) break
  }

  const totalLabeled = await prisma.messageLabel.count({
    where: {
      messageAtom: { importBatchId },
      promptVersionId,
      model,
    },
  })

  return {
    importBatchId,
    labelSpec: { model, promptVersionId },
    mode: 'stub',
    totals: {
      messageAtoms: totalAtoms,
      labeled: totalLabeled,
      newlyLabeled,
      skippedAlreadyLabeled: totalAtoms - newlyLabeled,
    },
  }
}

/**
 * Real classification: calls callLlm for each unlabeled atom.
 * Uses rate limiting and budget guard.
 */
async function classifyBatchReal(
  importBatchId: string,
  model: string,
  promptVersionId: string,
  totalAtoms: number,
  templateText: string,
): Promise<ClassifyResult> {
  const provider = inferProvider(model)
  const rateLimiter = new RateLimiter({ minDelayMs: getMinDelayMs() })
  const budgetPolicy = getSpendCaps()
  let spentUsdSoFar = 0
  let newlyLabeled = 0
  let cursor: string | undefined

  while (true) {
    const atomsBatch = await prisma.messageAtom.findMany({
      where: {
        importBatchId,
        messageLabels: {
          none: { promptVersionId, model },
        },
      },
      select: { id: true, atomStableId: true, text: true, source: true, role: true },
      take: BATCH_SIZE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { id: 'asc' },
    })

    if (atomsBatch.length === 0) break

    for (const atom of atomsBatch) {
      // Rate limit
      await rateLimiter.acquire()

      const ctx: LlmCallContext = {
        spentUsdSoFar,
        simulateCost: true,
      }

      // Budget guard: estimate next cost before calling
      // Use a conservative estimate for budget check
      const estimatedNextCost = 0.001
      assertWithinBudget({
        nextCostUsd: estimatedNextCost,
        spentUsdSoFar,
        policy: budgetPolicy,
      })

      const response = await callLlm(
        {
          provider,
          model,
          system: templateText,
          messages: [
            {
              role: 'user',
              content: `Source: ${atom.source}\nRole: ${atom.role}\n\n${atom.text}`,
            },
          ],
          temperature: 0,
          metadata: {
            stage: 'classify',
            atomStableId: atom.atomStableId,
          },
        },
        ctx,
      )

      spentUsdSoFar += response.costUsd

      // Parse and validate the LLM output
      const { category, confidence } = parseClassifyOutput(response.text)

      // Write label (skipDuplicates for concurrency safety)
      const result = await prisma.messageLabel.createMany({
        data: [{
          messageAtomId: atom.id,
          category,
          confidence,
          model,
          promptVersionId,
        }],
        skipDuplicates: true,
      })

      newlyLabeled += result.count
    }

    cursor = atomsBatch[atomsBatch.length - 1].id
    if (atomsBatch.length < BATCH_SIZE) break
  }

  const totalLabeled = await prisma.messageLabel.count({
    where: {
      messageAtom: { importBatchId },
      promptVersionId,
      model,
    },
  })

  return {
    importBatchId,
    labelSpec: { model, promptVersionId },
    mode: 'real',
    totals: {
      messageAtoms: totalAtoms,
      labeled: totalLabeled,
      newlyLabeled,
      skippedAlreadyLabeled: totalAtoms - newlyLabeled,
    },
  }
}

/**
 * Gets the active PromptVersion for the classify stage.
 * Returns null if none is active.
 */
export async function getActiveClassifyPromptVersion() {
  return prisma.promptVersion.findFirst({
    where: {
      isActive: true,
      prompt: {
        stage: 'CLASSIFY',
      },
    },
    include: {
      prompt: true,
    },
  })
}
