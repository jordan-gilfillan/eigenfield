/**
 * Classification Service
 *
 * Handles classification of MessageAtoms.
 * Supports stub mode (deterministic) and real mode (LLM-based, future).
 *
 * Spec references: 7.2 (Classify), 6.3 (MessageLabel), 6.4 (Category)
 */

import { prisma } from '../db'
import { sha256, hashToUint32 } from '../hash'
import type { Category } from '@prisma/client'

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
 * Classifies all MessageAtoms in an ImportBatch.
 *
 * Label versioning rules (spec 6.3):
 * - MessageLabel uniqueness is (messageAtomId, promptVersionId, model)
 * - Classification is idempotent for the same labelSpec
 * - If a label already exists for an atom with the same (promptVersionId, model), skip it
 *
 * @throws Error if importBatchId not found
 * @throws Error if promptVersionId not found
 * @throws Error if mode is 'real' (not implemented)
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

  // Verify prompt version exists
  const promptVersion = await prisma.promptVersion.findUnique({
    where: { id: promptVersionId },
  })
  if (!promptVersion) {
    throw new Error(`PromptVersion not found: ${promptVersionId}`)
  }

  // Real mode not implemented
  if (mode === 'real') {
    throw new Error('NOT_IMPLEMENTED: Real classification mode is not yet available')
  }

  // Count total atoms for this batch
  const totalAtoms = await prisma.messageAtom.count({
    where: { importBatchId },
  })

  if (totalAtoms === 0) {
    return {
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
    return {
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
  }

  // Process atoms in batches to avoid memory issues
  // Use cursor-based pagination for efficient iteration
  let newlyLabeled = 0
  let cursor: string | undefined

  while (true) {
    // Fetch a batch of atoms that DON'T have labels for this labelSpec
    // Using a subquery approach to avoid large IN clauses
    const atomsBatch = await prisma.messageAtom.findMany({
      where: {
        importBatchId,
        messageLabels: {
          none: {
            promptVersionId,
            model,
          },
        },
      },
      select: {
        id: true,
        atomStableId: true,
      },
      take: BATCH_SIZE,
      ...(cursor && {
        skip: 1,
        cursor: { id: cursor },
      }),
      orderBy: { id: 'asc' },
    })

    if (atomsBatch.length === 0) {
      break
    }

    // Create labels for this batch
    const labelsData = atomsBatch.map((atom) => ({
      messageAtomId: atom.id,
      category: computeStubCategory(atom.atomStableId),
      confidence: 0.5,
      model,
      promptVersionId,
    }))

    // Use createMany with skipDuplicates for concurrency safety
    const result = await prisma.messageLabel.createMany({
      data: labelsData,
      skipDuplicates: true,
    })

    newlyLabeled += result.count
    cursor = atomsBatch[atomsBatch.length - 1].id

    // If we got fewer than BATCH_SIZE, we're done
    if (atomsBatch.length < BATCH_SIZE) {
      break
    }
  }

  // Count total labels now
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
    mode,
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
