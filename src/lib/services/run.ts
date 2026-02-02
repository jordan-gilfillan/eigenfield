/**
 * Run Service
 *
 * Handles run creation with config freezing and eligible day determination.
 *
 * Spec references: 6.8 (Run), 7.3 (Run creation), 8.1 (Filtering)
 */

import { prisma } from '../db'
import type { FilterMode, Source } from '@prisma/client'

/** Default max input tokens per spec 9.2 */
const DEFAULT_MAX_INPUT_TOKENS = 12000

export interface CreateRunOptions {
  importBatchId: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  sources: string[] // lowercase: chatgpt, claude, grok
  filterProfileId: string
  /** LLM model for summarization */
  model: string
  /** Label spec used for filtering */
  labelSpec: {
    model: string
    promptVersionId: string
  }
  /** Optional max input tokens (defaults to 12000) */
  maxInputTokens?: number
}

export interface CreateRunResult {
  id: string
  status: string
  importBatchId: string
  startDate: string
  endDate: string
  sources: string[]
  filterProfileId: string
  model: string
  outputTarget: string
  config: {
    promptVersionIds: { summarize: string }
    labelSpec: { model: string; promptVersionId: string }
    filterProfile: { name: string; mode: string; categories: string[] }
    timezone: string
    maxInputTokens: number
  }
  jobCount: number
  eligibleDays: string[]
  createdAt: string
  updatedAt: string
}

/**
 * Creates a new Run with frozen config and jobs for each eligible day.
 *
 * @throws Error if importBatchId not found
 * @throws Error if filterProfileId not found
 * @throws Error if no active summarize prompt version
 * @throws Error if no eligible days (NO_ELIGIBLE_DAYS)
 */
export async function createRun(options: CreateRunOptions): Promise<CreateRunResult> {
  const {
    importBatchId,
    startDate,
    endDate,
    sources,
    filterProfileId,
    model,
    labelSpec,
    maxInputTokens = DEFAULT_MAX_INPUT_TOKENS,
  } = options

  // 1. Verify import batch exists and get timezone
  const importBatch = await prisma.importBatch.findUnique({
    where: { id: importBatchId },
  })
  if (!importBatch) {
    throw new Error(`ImportBatch not found: ${importBatchId}`)
  }

  // 2. Verify filter profile exists and snapshot it
  const filterProfile = await prisma.filterProfile.findUnique({
    where: { id: filterProfileId },
  })
  if (!filterProfile) {
    throw new Error(`FilterProfile not found: ${filterProfileId}`)
  }

  // 3. Get active summarize prompt version
  const summarizePromptVersion = await prisma.promptVersion.findFirst({
    where: {
      isActive: true,
      prompt: { stage: 'SUMMARIZE' },
    },
  })
  if (!summarizePromptVersion) {
    throw new Error('No active summarize prompt version found')
  }

  // 4. Verify labelSpec.promptVersionId exists
  const classifyPromptVersion = await prisma.promptVersion.findUnique({
    where: { id: labelSpec.promptVersionId },
  })
  if (!classifyPromptVersion) {
    throw new Error(`LabelSpec promptVersionId not found: ${labelSpec.promptVersionId}`)
  }

  // 5. Determine eligible days
  const eligibleDays = await findEligibleDays({
    importBatchId,
    startDate,
    endDate,
    sources,
    filterProfile: {
      mode: filterProfile.mode,
      categories: filterProfile.categories as string[],
    },
    labelSpec,
  })

  if (eligibleDays.length === 0) {
    throw new Error('NO_ELIGIBLE_DAYS: No days match the filter criteria')
  }

  // 6. Create run with frozen config
  const filterProfileSnapshot = {
    name: filterProfile.name,
    mode: filterProfile.mode.toLowerCase(),
    categories: filterProfile.categories as string[],
  }

  const configJson = {
    promptVersionIds: {
      summarize: summarizePromptVersion.id,
    },
    labelSpec: {
      model: labelSpec.model,
      promptVersionId: labelSpec.promptVersionId,
    },
    filterProfileSnapshot,
    timezone: importBatch.timezone,
    maxInputTokens,
  }

  // Convert sources to uppercase for DB
  const dbSources = sources.map((s) => s.toUpperCase()) as Source[]

  const run = await prisma.run.create({
    data: {
      importBatchId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      sources: dbSources,
      filterProfileId,
      model,
      outputTarget: 'db',
      configJson,
      status: 'QUEUED',
    },
  })

  // 7. Create jobs for each eligible day
  const jobsData = eligibleDays.map((dayDate) => ({
    runId: run.id,
    dayDate: new Date(dayDate),
    status: 'QUEUED' as const,
    attempt: 1,
  }))

  await prisma.job.createMany({
    data: jobsData,
  })

  // 8. Return response per spec 7.9
  return {
    id: run.id,
    status: run.status.toLowerCase(),
    importBatchId: run.importBatchId,
    startDate,
    endDate,
    sources,
    filterProfileId: run.filterProfileId,
    model: run.model,
    outputTarget: run.outputTarget,
    config: {
      promptVersionIds: configJson.promptVersionIds,
      labelSpec: configJson.labelSpec,
      filterProfile: configJson.filterProfileSnapshot,
      timezone: configJson.timezone,
      maxInputTokens: configJson.maxInputTokens,
    },
    jobCount: eligibleDays.length,
    eligibleDays,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  }
}

/**
 * Finds days that have at least one MessageAtom matching:
 * - importBatchId
 * - sources
 * - date range
 * - has a MessageLabel matching labelSpec
 * - passes filter profile
 */
async function findEligibleDays(options: {
  importBatchId: string
  startDate: string
  endDate: string
  sources: string[]
  filterProfile: {
    mode: FilterMode
    categories: string[]
  }
  labelSpec: {
    model: string
    promptVersionId: string
  }
}): Promise<string[]> {
  const { importBatchId, startDate, endDate, sources, filterProfile, labelSpec } = options

  // Convert sources to uppercase for DB query
  const dbSources = sources.map((s) => s.toUpperCase())

  // Build category filter based on mode
  // INCLUDE: label.category must be in filterProfile.categories
  // EXCLUDE: label.category must NOT be in filterProfile.categories
  const categoryCondition =
    filterProfile.mode === 'INCLUDE'
      ? { in: filterProfile.categories }
      : { notIn: filterProfile.categories }

  // Find distinct dayDates where atoms exist with matching labels
  const atomsWithLabels = await prisma.messageAtom.findMany({
    where: {
      importBatchId,
      source: { in: dbSources as Source[] },
      dayDate: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
      messageLabels: {
        some: {
          model: labelSpec.model,
          promptVersionId: labelSpec.promptVersionId,
          category: categoryCondition,
        },
      },
    },
    select: {
      dayDate: true,
    },
    distinct: ['dayDate'],
    orderBy: { dayDate: 'asc' },
  })

  // Convert to YYYY-MM-DD strings
  return atomsWithLabels.map((a) => {
    const d = a.dayDate
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  })
}

/**
 * Gets a run by ID with its config.
 */
export async function getRun(runId: string) {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      importBatch: true,
      filterProfile: true,
    },
  })

  if (!run) {
    return null
  }

  const config = run.configJson as {
    promptVersionIds: { summarize: string }
    labelSpec: { model: string; promptVersionId: string }
    filterProfileSnapshot: { name: string; mode: string; categories: string[] }
    timezone: string
    maxInputTokens: number
  }

  return {
    id: run.id,
    status: run.status.toLowerCase(),
    importBatchId: run.importBatchId,
    startDate: formatDate(run.startDate),
    endDate: formatDate(run.endDate),
    sources: (run.sources as string[]).map((s) => s.toLowerCase()),
    filterProfileId: run.filterProfileId,
    model: run.model,
    outputTarget: run.outputTarget,
    config,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  }
}

function formatDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
