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

/**
 * Small explicit alias map for common near-miss categories emitted by models.
 * Keep this intentionally tiny to preserve closed-set behavior.
 */
const CATEGORY_ALIASES: Readonly<Record<string, Category>> = {
  ETHICAL: 'PERSONAL',
  ETHICS: 'PERSONAL',
  MORAL: 'PERSONAL',
  VALUES: 'PERSONAL',
}

/** Batch size for processing to avoid Postgres bind variable limits */
const BATCH_SIZE = 10000
const SAMPLE_CAP = 5
const CHECKPOINT_ATOM_INTERVAL = 100
const CHECKPOINT_MS_INTERVAL = 5000

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
  warnings?: {
    skippedBadOutput: number
    aliasedCount: number
    badCategorySamples: string[]
    aliasedCategorySamples: string[]
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
function extractJsonCandidates(rawText: string): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()

  const addCandidate = (candidate: string) => {
    const trimmed = candidate.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    candidates.push(trimmed)
  }

  // Fast path: already clean JSON
  addCandidate(rawText)

  // Common LLM wrapper: fenced code blocks
  const fencedBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi
  let match: RegExpExecArray | null
  while ((match = fencedBlockRegex.exec(rawText)) !== null) {
    addCandidate(match[1])
  }

  // Fallback: first valid balanced JSON object embedded in prose
  let depth = 0
  let objectStart = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      if (depth === 0) objectStart = i
      depth += 1
      continue
    }

    if (ch === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && objectStart >= 0) {
        addCandidate(rawText.slice(objectStart, i + 1))
        objectStart = -1
      }
    }
  }

  return candidates
}

function normalizeCategory(rawCategory: string): { category: string; aliasedFrom?: string } {
  const normalized = rawCategory
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')

  const aliased = CATEGORY_ALIASES[normalized]
  if (aliased) {
    return { category: aliased, aliasedFrom: normalized }
  }
  return { category: normalized }
}

export function parseClassifyOutput(text: string): { category: Category; confidence: number; aliasedFrom?: string } {
  let parsed: unknown
  const parseErrors: string[] = []

  for (const candidate of extractJsonCandidates(text)) {
    try {
      parsed = JSON.parse(candidate)
      break
    } catch (err) {
      parseErrors.push(err instanceof Error ? err.message : 'Unknown parse error')
    }
  }

  if (parsed === undefined) {
    throw new LlmBadOutputError('LLM output is not valid JSON', {
      rawOutput: text,
      candidatesTried: parseErrors.length,
      parseErrors: parseErrors.slice(0, 3),
    })
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new LlmBadOutputError('LLM output is not a JSON object', { rawOutput: text })
  }

  const obj = parsed as Record<string, unknown>

  // Validate category
  if (typeof obj.category !== 'string') {
    throw new LlmBadOutputError('LLM output missing or invalid "category" field', { rawOutput: text })
  }
  const normalized = normalizeCategory(obj.category)
  const categoryUpper = normalized.category
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
    aliasedFrom: normalized.aliasedFrom,
  }
}

interface ClassifyProgress {
  processedAtoms: number
  newlyLabeled: number
  skippedBadOutput: number
  aliasedCount: number
  tokensIn: number
  tokensOut: number
  costUsd: number
  lastAtomStableIdProcessed: string | null
}

interface CheckpointState {
  lastWriteMs: number
  lastWrittenProcessedAtoms: number
}

interface PersistedClassifyError {
  code: string
  message: string
  details?: Record<string, unknown>
}

const ERROR_MESSAGE_MAX_CHARS = 500
const ERROR_DETAILS_MAX_CHARS = 2000

function capString(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`
}

function capErrorDetails(details: unknown): Record<string, unknown> | undefined {
  if (details === undefined || details === null) return undefined

  if (typeof details !== 'object') {
    return { value: capString(String(details), ERROR_DETAILS_MAX_CHARS) }
  }

  try {
    const serialized = JSON.stringify(details)
    if (!serialized) return undefined
    if (serialized.length <= ERROR_DETAILS_MAX_CHARS) {
      return details as Record<string, unknown>
    }
    return {
      truncated: true,
      length: serialized.length,
      preview: serialized.slice(0, ERROR_DETAILS_MAX_CHARS),
    }
  } catch {
    return { truncated: true, reason: 'details_not_serializable' }
  }
}

function toPersistedClassifyError(error: unknown): PersistedClassifyError {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : 'INTERNAL'

  const message = error instanceof Error ? error.message : String(error)
  const details =
    typeof error === 'object' &&
    error !== null &&
    'details' in error
      ? capErrorDetails((error as { details?: unknown }).details)
      : undefined

  return {
    code,
    message: capString(message, ERROR_MESSAGE_MAX_CHARS),
    ...(details ? { details } : {}),
  }
}

async function countLabelsForSpec(
  importBatchId: string,
  promptVersionId: string,
  model: string,
): Promise<number> {
  return prisma.messageLabel.count({
    where: {
      messageAtom: { importBatchId },
      promptVersionId,
      model,
    },
  })
}

function buildProgressSnapshot(
  totalAtoms: number,
  existingLabelCount: number,
  progress: ClassifyProgress,
): {
  processedAtoms: number
  newlyLabeled: number
  skippedAlreadyLabeled: number
  skippedBadOutput: number
  aliasedCount: number
  labeledTotal: number
} {
  const processedAtoms = Math.min(existingLabelCount + progress.processedAtoms, totalAtoms)
  const labeledTotal = Math.min(existingLabelCount + progress.newlyLabeled, totalAtoms)
  const skippedAlreadyLabeled = Math.max(
    processedAtoms - progress.newlyLabeled - progress.skippedBadOutput,
    0,
  )

  return {
    processedAtoms,
    newlyLabeled: progress.newlyLabeled,
    skippedAlreadyLabeled,
    skippedBadOutput: progress.skippedBadOutput,
    aliasedCount: progress.aliasedCount,
    labeledTotal,
  }
}

async function maybeCheckpointClassifyRun(
  classifyRunId: string,
  mode: 'stub' | 'real',
  totalAtoms: number,
  existingLabelCount: number,
  progress: ClassifyProgress,
  checkpointState: CheckpointState,
  force = false,
): Promise<void> {
  const now = Date.now()
  const processedSinceLastWrite = progress.processedAtoms - checkpointState.lastWrittenProcessedAtoms
  const timeSinceLastWrite = now - checkpointState.lastWriteMs

  if (!force && processedSinceLastWrite < CHECKPOINT_ATOM_INTERVAL && timeSinceLastWrite <= CHECKPOINT_MS_INTERVAL) {
    return
  }

  const snapshot = buildProgressSnapshot(totalAtoms, existingLabelCount, progress)

  await prisma.classifyRun.update({
    where: { id: classifyRunId },
    data: {
      processedAtoms: snapshot.processedAtoms,
      newlyLabeled: snapshot.newlyLabeled,
      skippedAlreadyLabeled: snapshot.skippedAlreadyLabeled,
      skippedBadOutput: snapshot.skippedBadOutput,
      aliasedCount: snapshot.aliasedCount,
      labeledTotal: snapshot.labeledTotal,
      lastAtomStableIdProcessed: progress.lastAtomStableIdProcessed,
      ...(mode === 'real'
        ? {
            tokensIn: progress.tokensIn,
            tokensOut: progress.tokensOut,
            costUsd: progress.costUsd,
          }
        : {}),
    },
  })

  checkpointState.lastWriteMs = now
  checkpointState.lastWrittenProcessedAtoms = progress.processedAtoms
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

  // Count totals for this batch + labelSpec and create an auditable running row.
  const totalAtoms = await prisma.messageAtom.count({ where: { importBatchId } })
  const existingLabelCount = await countLabelsForSpec(importBatchId, promptVersionId, model)

  const progress: ClassifyProgress = {
    processedAtoms: 0,
    newlyLabeled: 0,
    skippedBadOutput: 0,
    aliasedCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastAtomStableIdProcessed: null,
  }
  const checkpointState: CheckpointState = {
    lastWriteMs: Date.now(),
    lastWrittenProcessedAtoms: 0,
  }

  const classifyRun = await prisma.classifyRun.create({
    data: {
      importBatchId,
      model,
      promptVersionId,
      mode,
      status: 'running',
      totalAtoms,
      processedAtoms: 0,
      newlyLabeled: 0,
      skippedAlreadyLabeled: existingLabelCount,
      skippedBadOutput: 0,
      aliasedCount: 0,
      labeledTotal: existingLabelCount,
      lastAtomStableIdProcessed: null,
      startedAt: new Date(),
    },
  })

  try {
    if (totalAtoms === 0) {
      const result: ClassifyResult = {
        importBatchId,
        labelSpec: { model, promptVersionId },
        mode,
        totals: {
          messageAtoms: 0,
          labeled: existingLabelCount,
          newlyLabeled: 0,
          skippedAlreadyLabeled: 0,
        },
      }

      await prisma.classifyRun.update({
        where: { id: classifyRun.id },
        data: {
          status: 'succeeded',
          finishedAt: new Date(),
          processedAtoms: 0,
          newlyLabeled: 0,
          skippedAlreadyLabeled: 0,
          skippedBadOutput: 0,
          aliasedCount: 0,
          labeledTotal: existingLabelCount,
          lastAtomStableIdProcessed: null,
        },
      })

      return result
    }

    // If all atoms already labeled, skip processing but still finalize the audit row.
    if (existingLabelCount >= totalAtoms) {
      const result: ClassifyResult = {
        importBatchId,
        labelSpec: { model, promptVersionId },
        mode,
        totals: {
          messageAtoms: totalAtoms,
          labeled: existingLabelCount,
          newlyLabeled: 0,
          skippedAlreadyLabeled: existingLabelCount,
        },
      }

      await prisma.classifyRun.update({
        where: { id: classifyRun.id },
        data: {
          status: 'succeeded',
          finishedAt: new Date(),
          processedAtoms: totalAtoms,
          newlyLabeled: 0,
          skippedAlreadyLabeled: existingLabelCount,
          skippedBadOutput: 0,
          aliasedCount: 0,
          labeledTotal: existingLabelCount,
          lastAtomStableIdProcessed: null,
        },
      })

      return result
    }

    // Dispatch to mode-specific implementation
    let result: ClassifyResult
    if (mode === 'stub') {
      result = await classifyBatchStub(importBatchId, model, promptVersionId, totalAtoms, progress)
    } else {
      result = await classifyBatchReal(
        classifyRun.id,
        importBatchId,
        model,
        promptVersionId,
        totalAtoms,
        existingLabelCount,
        promptVersion.templateText,
        progress,
        checkpointState,
      )
    }

    await prisma.classifyRun.update({
      where: { id: classifyRun.id },
      data: {
        status: 'succeeded',
        finishedAt: new Date(),
        processedAtoms: totalAtoms,
        totalAtoms: result.totals.messageAtoms,
        newlyLabeled: result.totals.newlyLabeled,
        skippedAlreadyLabeled: result.totals.skippedAlreadyLabeled,
        skippedBadOutput: result.warnings?.skippedBadOutput ?? progress.skippedBadOutput,
        aliasedCount: result.warnings?.aliasedCount ?? progress.aliasedCount,
        labeledTotal: result.totals.labeled,
        lastAtomStableIdProcessed: progress.lastAtomStableIdProcessed,
        ...(mode === 'real'
          ? {
              tokensIn: progress.tokensIn,
              tokensOut: progress.tokensOut,
              costUsd: progress.costUsd,
            }
          : {}),
      },
    })

    return result
  } catch (error) {
    try {
      const snapshot = buildProgressSnapshot(totalAtoms, existingLabelCount, progress)

      await prisma.classifyRun.update({
        where: { id: classifyRun.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          processedAtoms: snapshot.processedAtoms,
          newlyLabeled: snapshot.newlyLabeled,
          skippedAlreadyLabeled: snapshot.skippedAlreadyLabeled,
          skippedBadOutput: snapshot.skippedBadOutput,
          aliasedCount: snapshot.aliasedCount,
          labeledTotal: snapshot.labeledTotal,
          lastAtomStableIdProcessed: progress.lastAtomStableIdProcessed,
          ...(mode === 'real'
            ? {
                tokensIn: progress.tokensIn,
                tokensOut: progress.tokensOut,
                costUsd: progress.costUsd,
              }
            : {}),
          errorJson: toPersistedClassifyError(error),
        },
      })
    } catch (persistError) {
      console.error('Failed to persist classify failure audit trail:', persistError)
    }

    throw error
  }
}

/**
 * Stub classification: deterministic categories based on atomStableId hash.
 */
async function classifyBatchStub(
  importBatchId: string,
  model: string,
  promptVersionId: string,
  totalAtoms: number,
  progress: ClassifyProgress,
): Promise<ClassifyResult> {
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

    progress.newlyLabeled += result.count
    progress.processedAtoms += atomsBatch.length
    progress.lastAtomStableIdProcessed = atomsBatch[atomsBatch.length - 1].atomStableId
    cursor = atomsBatch[atomsBatch.length - 1].id

    if (atomsBatch.length < BATCH_SIZE) break
  }

  const totalLabeled = await countLabelsForSpec(importBatchId, promptVersionId, model)

  return {
    importBatchId,
    labelSpec: { model, promptVersionId },
    mode: 'stub',
    totals: {
      messageAtoms: totalAtoms,
      labeled: totalLabeled,
      newlyLabeled: progress.newlyLabeled,
      skippedAlreadyLabeled: Math.max(totalLabeled - progress.newlyLabeled, 0),
    },
  }
}

/**
 * Real classification: calls callLlm for each unlabeled atom.
 * Uses rate limiting and budget guard.
 */
async function classifyBatchReal(
  classifyRunId: string,
  importBatchId: string,
  model: string,
  promptVersionId: string,
  totalAtoms: number,
  existingLabelCount: number,
  templateText: string,
  progress: ClassifyProgress,
  checkpointState: CheckpointState,
): Promise<ClassifyResult> {
  const provider = inferProvider(model)
  const rateLimiter = new RateLimiter({ minDelayMs: getMinDelayMs() })
  const budgetPolicy = getSpendCaps()
  let spentUsdSoFar = progress.costUsd
  const badCategorySamples: string[] = []
  const aliasedCategorySamples: string[] = []
  let cursor: string | undefined

  const addSample = (samples: string[], value: string) => {
    if (samples.length >= SAMPLE_CAP || samples.includes(value)) return
    samples.push(value)
  }

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

      progress.tokensIn += response.tokensIn
      progress.tokensOut += response.tokensOut
      progress.costUsd += response.costUsd
      spentUsdSoFar += response.costUsd

      let parsed: { category: Category; confidence: number; aliasedFrom?: string }
      try {
        // Parse and validate the LLM output
        parsed = parseClassifyOutput(response.text)
      } catch (error) {
        if (error instanceof LlmBadOutputError) {
          progress.skippedBadOutput += 1
          progress.processedAtoms += 1
          progress.lastAtomStableIdProcessed = atom.atomStableId
          if (typeof error.details?.category === 'string') {
            addSample(badCategorySamples, error.details.category)
          }
          await maybeCheckpointClassifyRun(
            classifyRunId,
            'real',
            totalAtoms,
            existingLabelCount,
            progress,
            checkpointState,
          )
          continue
        }
        throw error
      }

      if (parsed.aliasedFrom) {
        progress.aliasedCount += 1
        addSample(aliasedCategorySamples, parsed.aliasedFrom)
      }

      // Write label (skipDuplicates for concurrency safety)
      const result = await prisma.messageLabel.createMany({
        data: [{
          messageAtomId: atom.id,
          category: parsed.category,
          confidence: parsed.confidence,
          model,
          promptVersionId,
        }],
        skipDuplicates: true,
      })

      progress.newlyLabeled += result.count
      progress.processedAtoms += 1
      progress.lastAtomStableIdProcessed = atom.atomStableId
      await maybeCheckpointClassifyRun(
        classifyRunId,
        'real',
        totalAtoms,
        existingLabelCount,
        progress,
        checkpointState,
      )
    }

    cursor = atomsBatch[atomsBatch.length - 1].id
    if (atomsBatch.length < BATCH_SIZE) break
  }

  const totalLabeled = await countLabelsForSpec(importBatchId, promptVersionId, model)

  return {
    importBatchId,
    labelSpec: { model, promptVersionId },
    mode: 'real',
    totals: {
      messageAtoms: totalAtoms,
      labeled: totalLabeled,
      newlyLabeled: progress.newlyLabeled,
      skippedAlreadyLabeled: Math.max(totalLabeled - progress.newlyLabeled, 0),
    },
    warnings: {
      skippedBadOutput: progress.skippedBadOutput,
      aliasedCount: progress.aliasedCount,
      badCategorySamples,
      aliasedCategorySamples,
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
