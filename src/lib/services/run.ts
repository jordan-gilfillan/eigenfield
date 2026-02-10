/**
 * Run Service
 *
 * Handles run creation with config freezing and eligible day determination.
 *
 * Spec references: 6.8 (Run), 7.3 (Run creation), 8.1 (Filtering)
 */

import { prisma } from '../db'
import type { FilterMode, Source } from '@prisma/client'
import { buildPricingSnapshot, inferProvider } from '../llm'
import type { PricingSnapshot } from '../llm'

/** Default max input tokens per spec 9.2 */
const DEFAULT_MAX_INPUT_TOKENS = 12000

/** Default classifier model per SPEC §7.3 (v0.3 default) */
const DEFAULT_CLASSIFY_MODEL = 'stub_v1'

/**
 * Thrown when selected batches have different timezones.
 * Per SPEC §7.3 step 0b.
 */
export class TimezoneMismatchError extends Error {
  code = 'TIMEZONE_MISMATCH' as const
  timezones: string[]
  batchIds: string[]

  constructor(timezones: string[], batchIds: string[]) {
    super(`Selected batches have different timezones: ${timezones.join(', ')}`)
    this.name = 'TimezoneMismatchError'
    this.timezones = timezones
    this.batchIds = batchIds
  }
}

export interface CreateRunOptions {
  /** Single batch (backward compat). Mutually exclusive with importBatchIds. */
  importBatchId?: string
  /** Multiple batches (preferred). Mutually exclusive with importBatchId. */
  importBatchIds?: string[]
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  sources: string[] // lowercase: chatgpt, claude, grok
  filterProfileId: string
  /** LLM model for summarization */
  model: string
  /** Label spec used for filtering (optional; server selects default if omitted) */
  labelSpec?: {
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
  importBatchIds: string[]
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
    pricingSnapshot?: PricingSnapshot
    importBatchIds?: string[]
  }
  jobCount: number
  eligibleDays: string[]
  createdAt: string
  updatedAt: string
}

/**
 * Resolves importBatchId/importBatchIds XOR into a canonical array.
 * Per SPEC §7.3 step 0a.
 */
function resolveImportBatchIds(options: CreateRunOptions): string[] {
  const { importBatchId, importBatchIds } = options
  if (importBatchId && importBatchIds) {
    throw new Error('INVALID_INPUT: Provide importBatchId or importBatchIds, not both')
  }
  if (!importBatchId && !importBatchIds) {
    throw new Error('INVALID_INPUT: importBatchId or importBatchIds is required')
  }
  if (importBatchIds) {
    if (importBatchIds.length === 0) {
      throw new Error('INVALID_INPUT: importBatchIds must be non-empty')
    }
    if (new Set(importBatchIds).size !== importBatchIds.length) {
      throw new Error('INVALID_INPUT: importBatchIds must contain unique elements')
    }
    return importBatchIds
  }
  return [importBatchId!]
}

/**
 * Creates a new Run with frozen config and jobs for each eligible day.
 *
 * Supports multi-batch runs per SPEC §6.8a / §7.3.
 *
 * @throws Error if importBatchId not found
 * @throws TimezoneMismatchError if batches have different timezones
 * @throws Error if filterProfileId not found
 * @throws Error if no active summarize prompt version
 * @throws Error if no eligible days (NO_ELIGIBLE_DAYS)
 */
export async function createRun(options: CreateRunOptions): Promise<CreateRunResult> {
  const {
    startDate,
    endDate,
    sources,
    filterProfileId,
    model,
    maxInputTokens = DEFAULT_MAX_INPUT_TOKENS,
  } = options

  // 0a. Resolve importBatchIds (XOR normalization)
  const importBatchIds = resolveImportBatchIds(options)

  // 0b. Fetch all batches, validate existence and timezone uniformity
  const importBatches = await prisma.importBatch.findMany({
    where: { id: { in: importBatchIds } },
  })

  // Check all batches exist
  if (importBatches.length !== importBatchIds.length) {
    const foundIds = new Set(importBatches.map((b) => b.id))
    const missingId = importBatchIds.find((id) => !foundIds.has(id))
    throw new Error(`ImportBatch not found: ${missingId}`)
  }

  // Check timezone uniformity
  const timezones = [...new Set(importBatches.map((b) => b.timezone))]
  if (timezones.length > 1) {
    throw new TimezoneMismatchError(timezones, importBatchIds)
  }

  const timezone = timezones[0]

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

  // 4. Resolve labelSpec: use provided or select default per SPEC §7.3
  let labelSpec: { model: string; promptVersionId: string }
  if (options.labelSpec) {
    // Verify provided labelSpec.promptVersionId exists
    const classifyPromptVersion = await prisma.promptVersion.findUnique({
      where: { id: options.labelSpec.promptVersionId },
    })
    if (!classifyPromptVersion) {
      throw new Error(`LabelSpec promptVersionId not found: ${options.labelSpec.promptVersionId}`)
    }
    labelSpec = options.labelSpec
  } else {
    // Default: active classify PromptVersion + default classifier model (stub_v1)
    const activeClassifyVersion = await prisma.promptVersion.findFirst({
      where: {
        isActive: true,
        prompt: { stage: 'CLASSIFY' },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!activeClassifyVersion) {
      throw new Error('No active classify prompt version found')
    }
    labelSpec = {
      model: DEFAULT_CLASSIFY_MODEL,
      promptVersionId: activeClassifyVersion.id,
    }
  }

  // 5. Determine eligible days (across all batches)
  const eligibleDays = await findEligibleDays({
    importBatchIds,
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

  // 6. Capture pricing snapshot for the summarizer model
  const provider = inferProvider(model)
  const pricingSnapshot = buildPricingSnapshot(provider, model)

  // 7. Create run with frozen config + RunBatch junction rows
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
    timezone,
    maxInputTokens,
    pricingSnapshot: { ...pricingSnapshot },
    importBatchIds,
  }

  // Convert sources to uppercase for DB
  const dbSources = sources.map((s) => s.toUpperCase()) as Source[]

  const run = await prisma.run.create({
    data: {
      importBatchId: importBatchIds[0], // deprecated, kept for backward compat
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      sources: dbSources,
      filterProfileId,
      model,
      outputTarget: 'db',
      configJson,
      status: 'QUEUED',
      runBatches: {
        create: importBatchIds.map((batchId) => ({
          importBatchId: batchId,
        })),
      },
    },
  })

  // 8. Create jobs for each eligible day
  const jobsData = eligibleDays.map((dayDate) => ({
    runId: run.id,
    dayDate: new Date(dayDate),
    status: 'QUEUED' as const,
    attempt: 1,
  }))

  await prisma.job.createMany({
    data: jobsData,
  })

  // 9. Return response per spec 7.9
  return {
    id: run.id,
    status: run.status.toLowerCase(),
    importBatchId: run.importBatchId,
    importBatchIds,
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
      pricingSnapshot: configJson.pricingSnapshot,
      importBatchIds: configJson.importBatchIds,
    },
    jobCount: eligibleDays.length,
    eligibleDays,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  }
}

/**
 * Finds days that have at least one MessageAtom matching:
 * - importBatchId IN (importBatchIds)
 * - sources
 * - date range
 * - has a MessageLabel matching labelSpec
 * - passes filter profile
 */
async function findEligibleDays(options: {
  importBatchIds: string[]
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
  const { importBatchIds, startDate, endDate, sources, filterProfile, labelSpec } = options

  // Convert sources to uppercase for DB query
  const dbSources = sources.map((s) => s.toUpperCase())

  // Build category filter based on mode
  // INCLUDE: label.category must be in filterProfile.categories
  // EXCLUDE: label.category must NOT be in filterProfile.categories
  const categoryCondition =
    filterProfile.mode === 'INCLUDE'
      ? { in: filterProfile.categories }
      : { notIn: filterProfile.categories }

  // Find distinct dayDates where USER atoms exist with matching labels (across all batches)
  // Only role=USER atoms make a day eligible (SPEC §7.3 step 6)
  const atomsWithLabels = await prisma.messageAtom.findMany({
    where: {
      importBatchId: { in: importBatchIds },
      source: { in: dbSources as Source[] },
      role: 'USER',
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
  return atomsWithLabels.map((a) => formatDate(a.dayDate))
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
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ----- Run Controls (cancel/resume/reset) -----

export interface CancelRunResult {
  runId: string
  status: string
  jobsCancelled: number
}

/**
 * Cancels a run and all its queued jobs.
 *
 * Per spec 7.6: marks run cancelled; future ticks no-op.
 * Terminal status rule: cancelled is authoritative.
 *
 * @throws Error if run not found
 * @throws Error if run is already in terminal state
 */
export async function cancelRun(runId: string): Promise<CancelRunResult> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
  })

  if (!run) {
    throw new Error(`Run not found: ${runId}`)
  }

  // Check if already in terminal state
  if (run.status === 'CANCELLED') {
    return {
      runId,
      status: 'cancelled',
      jobsCancelled: 0,
    }
  }

  if (run.status === 'COMPLETED') {
    throw new Error('ALREADY_COMPLETED: Cannot cancel a completed run')
  }

  // Cancel all queued jobs
  const cancelledJobs = await prisma.job.updateMany({
    where: {
      runId,
      status: 'QUEUED',
    },
    data: {
      status: 'CANCELLED',
    },
  })

  // Update run status
  await prisma.run.update({
    where: { id: runId },
    data: { status: 'CANCELLED' },
  })

  return {
    runId,
    status: 'cancelled',
    jobsCancelled: cancelledJobs.count,
  }
}

export interface ResumeRunResult {
  runId: string
  status: string
  jobsRequeued: number
}

/**
 * Resumes a failed run by requeuing failed jobs.
 *
 * Per spec 7.6: resets FAILED jobs to QUEUED, sets run status to QUEUED.
 *
 * @throws Error if run not found
 * @throws Error if run is cancelled (terminal)
 */
export async function resumeRun(runId: string): Promise<ResumeRunResult> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
  })

  if (!run) {
    throw new Error(`Run not found: ${runId}`)
  }

  // Cannot resume a cancelled run per spec 7.6 terminal status rule
  if (run.status === 'CANCELLED') {
    throw new Error('CANNOT_RESUME_CANCELLED: Cancelled runs cannot be resumed')
  }

  // Requeue failed jobs
  const requeuedJobs = await prisma.job.updateMany({
    where: {
      runId,
      status: 'FAILED',
    },
    data: {
      status: 'QUEUED',
    },
  })

  // Only set run back to QUEUED if jobs were actually requeued
  if (requeuedJobs.count > 0) {
    await prisma.run.update({
      where: { id: runId },
      data: { status: 'QUEUED' },
    })
  }

  return {
    runId,
    status: requeuedJobs.count > 0 ? 'queued' : run.status.toLowerCase(),
    jobsRequeued: requeuedJobs.count,
  }
}

export interface ResetJobResult {
  runId: string
  dayDate: string
  status: string
  attempt: number
  outputsDeleted: number
}

/**
 * Resets a specific job for reprocessing.
 *
 * Per spec 7.7: deletes outputs, sets job status to QUEUED, increments attempt.
 *
 * @throws Error if run not found
 * @throws Error if run is cancelled
 * @throws Error if job not found
 */
export async function resetJob(runId: string, dayDate: string): Promise<ResetJobResult> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
  })

  if (!run) {
    throw new Error(`Run not found: ${runId}`)
  }

  // Cannot reset jobs in a cancelled run
  if (run.status === 'CANCELLED') {
    throw new Error('CANNOT_RESET_CANCELLED: Cannot reset jobs in a cancelled run')
  }

  // Find the job
  const job = await prisma.job.findFirst({
    where: {
      runId,
      dayDate: new Date(dayDate),
    },
  })

  if (!job) {
    throw new Error(`Job not found for run ${runId} and dayDate ${dayDate}`)
  }

  // Delete outputs for this job
  const deletedOutputs = await prisma.output.deleteMany({
    where: { jobId: job.id },
  })

  // Reset job to QUEUED and increment attempt
  const updatedJob = await prisma.job.update({
    where: { id: job.id },
    data: {
      status: 'QUEUED',
      attempt: job.attempt + 1,
      startedAt: null,
      finishedAt: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      error: null,
    },
  })

  // Set run back to QUEUED if it was COMPLETED or FAILED
  if (run.status === 'COMPLETED' || run.status === 'FAILED') {
    await prisma.run.update({
      where: { id: runId },
      data: { status: 'QUEUED' },
    })
  }

  return {
    runId,
    dayDate,
    status: 'queued',
    attempt: updatedJob.attempt,
    outputsDeleted: deletedOutputs.count,
  }
}
