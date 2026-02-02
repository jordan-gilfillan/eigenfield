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

  // Get all atoms for this import batch
  const atoms = await prisma.messageAtom.findMany({
    where: { importBatchId },
    select: {
      id: true,
      atomStableId: true,
    },
  })

  const totalAtoms = atoms.length

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

  // Check for existing labels with this labelSpec
  const existingLabels = await prisma.messageLabel.findMany({
    where: {
      messageAtomId: { in: atoms.map((a) => a.id) },
      promptVersionId,
      model,
    },
    select: { messageAtomId: true },
  })
  const existingSet = new Set(existingLabels.map((l) => l.messageAtomId))

  // Filter to atoms that need labeling
  const atomsToLabel = atoms.filter((a) => !existingSet.has(a.id))
  const skippedCount = atoms.length - atomsToLabel.length

  // Create labels for new atoms
  if (atomsToLabel.length > 0) {
    const labelsData = atomsToLabel.map((atom) => ({
      messageAtomId: atom.id,
      category: computeStubCategory(atom.atomStableId),
      confidence: 0.5,
      model,
      promptVersionId,
    }))

    // Use createMany with skipDuplicates for concurrency safety
    // This is safe because uniqueness is on (messageAtomId, promptVersionId, model)
    await prisma.messageLabel.createMany({
      data: labelsData,
      skipDuplicates: true,
    })
  }

  // Count total labels now (in case of concurrent classification)
  const totalLabeled = await prisma.messageLabel.count({
    where: {
      messageAtomId: { in: atoms.map((a) => a.id) },
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
      newlyLabeled: atomsToLabel.length,
      skippedAlreadyLabeled: skippedCount,
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
