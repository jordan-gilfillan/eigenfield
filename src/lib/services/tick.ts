/**
 * Tick Service
 *
 * Processes jobs for a run, one at a time with advisory lock protection.
 *
 * Spec references: 7.4 (Process tick loop), 6.9 (Job), 6.10 (Output)
 */

import { prisma } from '../db'
import { NotFoundError } from '../errors'
import { withLock } from './advisory-lock'
import { buildBundle, estimateTokens, segmentBundle } from './bundle'
import { summarize } from './summarizer'
import { estimateCostFromSnapshot, LlmError, LlmProviderError, BudgetExceededError, MissingApiKeyError, getSpendCaps, assertWithinBudget, RateLimiter, getMinDelayMs } from '../llm'
import type { BudgetPolicy } from '../llm'
import type { RunConfig } from '../types/run-config'
import { parseRunConfig } from '../types/run-config'
import type { JobStatus, RunStatus } from '@prisma/client'
import { getCalendarDaySpendUsd } from './budget-queries'

/** Default number of jobs to process per tick */
const DEFAULT_JOBS_PER_TICK = 1

export interface TickOptions {
  runId: string
  /** Max jobs to process (default: 1) */
  maxJobs?: number
}

export interface TickResult {
  runId: string
  processed: number
  jobs: Array<{
    dayDate: string
    status: string
    attempt: number
    tokensIn: number | null
    tokensOut: number | null
    costUsd: number | null
    error: string | null
  }>
  progress: {
    queued: number
    running: number
    succeeded: number
    failed: number
    cancelled: number
  }
  runStatus: string
}

/**
 * Processes up to N queued jobs for a run.
 *
 * Uses advisory lock to prevent concurrent ticks.
 *
 * @throws TickInProgressError if another tick is running
 * @throws NotFoundError if run not found
 */
export async function processTick(options: TickOptions): Promise<TickResult> {
  const { runId, maxJobs = DEFAULT_JOBS_PER_TICK } = options

  // Verify run exists
  const run = await prisma.run.findUnique({
    where: { id: runId },
  })
  if (!run) {
    throw new NotFoundError('Run', runId)
  }

  // Execute with advisory lock
  return withLock(runId, async () => {
    // Re-fetch run inside lock to get latest status
    const currentRun = await prisma.run.findUnique({
      where: { id: runId },
    })

    if (!currentRun) {
      throw new NotFoundError('Run', runId)
    }

    // Check terminal status per spec 7.6
    if (currentRun.status === 'CANCELLED') {
      return buildTickResult(runId, [], await getProgress(runId), 'cancelled')
    }

    // Get config from run
    const config = parseRunConfig(currentRun.configJson)

    // Create rate limiter shared across all jobs in this tick
    const rateLimiter = new RateLimiter({ minDelayMs: getMinDelayMs() })

    // Load budget policy and existing spend for budget enforcement
    const budgetPolicy = getSpendCaps()
    const [existingSpendAgg, daySpendAtStart] = await Promise.all([
      prisma.job.aggregate({
        where: { runId },
        _sum: { costUsd: true },
      }),
      getCalendarDaySpendUsd(),
    ])
    const existingRunSpend = existingSpendAgg._sum.costUsd ?? 0
    let tickSpentUsd = 0

    // Get queued jobs
    const queuedJobs = await prisma.job.findMany({
      where: {
        runId,
        status: 'QUEUED',
      },
      orderBy: { dayDate: 'asc' },
      take: maxJobs,
    })

    if (queuedJobs.length === 0) {
      // No jobs to process - check if run is complete
      const progress = await getProgress(runId)
      const newStatus = determineRunStatus(progress)

      if (currentRun.status !== newStatus) {
        await prisma.run.update({
          where: { id: runId },
          data: { status: newStatus },
        })
      }

      return buildTickResult(runId, [], progress, newStatus.toLowerCase())
    }

    // Update run status to RUNNING if not already
    if (currentRun.status !== 'RUNNING') {
      await prisma.run.update({
        where: { id: runId },
        data: { status: 'RUNNING' },
      })
    }

    // Read importBatchIds from RunBatch junction (canonical source per §6.8a)
    const runBatches = await prisma.runBatch.findMany({
      where: { runId },
      select: { importBatchId: true },
    })
    const importBatchIds = runBatches.map((rb) => rb.importBatchId)

    // Process each job
    const processedJobs: TickResult['jobs'] = []

    for (const job of queuedJobs) {
      const jobResult = await processJob(job.id, {
        importBatchIds,
        sources: (currentRun.sources as string[]).map((s) => s.toLowerCase()),
        model: currentRun.model,
        config,
        spentUsdRunSoFar: existingRunSpend + tickSpentUsd,
        spentUsdDaySoFar: daySpendAtStart + tickSpentUsd,
        budgetPolicy,
        rateLimiter,
      })
      processedJobs.push(jobResult)
      tickSpentUsd += jobResult.costUsd ?? 0
    }

    // Get updated progress
    const progress = await getProgress(runId)
    const newStatus = determineRunStatus(progress)

    // Update run status
    await prisma.run.update({
      where: { id: runId },
      data: { status: newStatus },
    })

    return buildTickResult(runId, processedJobs, progress, newStatus.toLowerCase())
  })
}

/**
 * Processes a single job: builds bundle, calls summarizer, stores output.
 */
async function processJob(
  jobId: string,
  context: {
    importBatchIds: string[]
    sources: string[]
    model: string
    config: RunConfig
    spentUsdRunSoFar: number
    spentUsdDaySoFar: number
    budgetPolicy: BudgetPolicy
    rateLimiter: RateLimiter
  }
): Promise<TickResult['jobs'][0]> {
  const { importBatchIds, sources, model, config, spentUsdRunSoFar, spentUsdDaySoFar, budgetPolicy, rateLimiter } = context

  // Mark job as running
  const job = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
    },
  })

  const dayDate = formatDate(job.dayDate)

  // Track tokens/cost across segments for partial capture on failure
  let totalTokensIn = 0
  let totalTokensOut = 0
  let totalCostUsd = 0

  try {
    // 1. Build bundle (across all batches per §9.1)
    const bundle = await buildBundle({
      importBatchIds,
      dayDate,
      sources,
      labelSpec: config.labelSpec,
      filterProfile: config.filterProfileSnapshot,
    })

    if (bundle.atomCount === 0) {
      // No atoms for this day (shouldn't happen, but handle gracefully)
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
        },
      })

      return {
        dayDate,
        status: 'succeeded',
        attempt: job.attempt,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        error: null,
      }
    }

    // 2. Check if segmentation needed
    const estimatedTokens = estimateTokens(bundle.bundleText)
    const needsSegmentation = estimatedTokens > config.maxInputTokens

    let outputText: string
    let outputMeta: {
      segmented: boolean
      segmentCount?: number
      segmentIds?: string[]
      atomCount: number
      estimatedInputTokens: number
    }

    if (needsSegmentation) {
      // Segment the bundle and process each segment
      const segmentation = segmentBundle(bundle.atoms, bundle.bundleHash, config.maxInputTokens)

      const segmentSummaries: string[] = []

      for (const segment of segmentation.segments) {
        // Rate limit for non-stub models
        if (!model.startsWith('stub')) await rateLimiter.acquire()

        // Pre-call budget check: block if already exceeded
        assertWithinBudget({ nextCostUsd: 0, spentUsdRunSoFar: spentUsdRunSoFar + totalCostUsd, spentUsdDaySoFar: spentUsdDaySoFar + totalCostUsd, policy: budgetPolicy })

        const segmentResult = await summarize({
          bundleText: segment.text,
          model,
          promptVersionId: config.promptVersionIds.summarize,
        })

        segmentSummaries.push(`## Segment ${segment.index + 1}\n\n${segmentResult.text}`)
        totalTokensIn += segmentResult.tokensIn ?? 0
        totalTokensOut += segmentResult.tokensOut ?? 0
        totalCostUsd += segmentResult.costUsd ?? 0

        // Post-call budget check: stop remaining segments if actual cost exceeded cap
        assertWithinBudget({ nextCostUsd: 0, spentUsdRunSoFar: spentUsdRunSoFar + totalCostUsd, spentUsdDaySoFar: spentUsdDaySoFar + totalCostUsd, policy: budgetPolicy })
      }

      // Concatenate segment summaries per spec 9.2
      outputText = segmentSummaries.join('\n\n')
      outputMeta = {
        segmented: true,
        segmentCount: segmentation.segmentCount,
        segmentIds: segmentation.segments.map((s) => s.segmentId),
        atomCount: bundle.atomCount,
        estimatedInputTokens: estimatedTokens,
      }
    } else {
      // No segmentation needed - process as single bundle
      // Rate limit for non-stub models
      if (!model.startsWith('stub')) await rateLimiter.acquire()

      // Pre-call budget check: block if already exceeded
      assertWithinBudget({ nextCostUsd: 0, spentUsdRunSoFar, spentUsdDaySoFar, policy: budgetPolicy })

      const summaryResult = await summarize({
        bundleText: bundle.bundleText,
        model,
        promptVersionId: config.promptVersionIds.summarize,
      })

      outputText = summaryResult.text
      totalTokensIn = summaryResult.tokensIn ?? 0
      totalTokensOut = summaryResult.tokensOut ?? 0
      totalCostUsd = summaryResult.costUsd ?? 0

      // Post-call budget check: stop if actual cost exceeded cap
      assertWithinBudget({ nextCostUsd: 0, spentUsdRunSoFar: spentUsdRunSoFar + totalCostUsd, spentUsdDaySoFar: spentUsdDaySoFar + totalCostUsd, policy: budgetPolicy })

      outputMeta = {
        segmented: false,
        atomCount: bundle.atomCount,
        estimatedInputTokens: estimatedTokens,
      }
    }

    // 2b. Fallback: estimate cost from pricing snapshot only when provider reported zero
    if (config.pricingSnapshot && !model.startsWith('stub') && totalCostUsd === 0) {
      totalCostUsd = estimateCostFromSnapshot(config.pricingSnapshot, totalTokensIn, totalTokensOut)
    }

    // 3. Store output
    await prisma.output.create({
      data: {
        jobId,
        stage: 'SUMMARIZE',
        outputText,
        outputJson: { meta: outputMeta },
        model,
        promptVersionId: config.promptVersionIds.summarize,
        bundleHash: bundle.bundleHash,
        bundleContextHash: bundle.bundleContextHash,
      },
    })

    // 4. Update job as succeeded
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        costUsd: totalCostUsd,
      },
    })

    return {
      dayDate,
      status: 'succeeded',
      attempt: updatedJob.attempt,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      costUsd: totalCostUsd,
      error: null,
    }
  } catch (error) {
    // Determine error code and retriability from LLM error types
    const errorMessage = error instanceof Error ? error.message : String(error)
    let errorCode = 'PROCESSING_ERROR'
    let retriable = true

    if (error instanceof LlmProviderError) {
      errorCode = 'LLM_PROVIDER_ERROR'
      retriable = true // Provider errors (rate limits, timeouts) are retriable
    } else if (error instanceof BudgetExceededError) {
      errorCode = 'BUDGET_EXCEEDED'
      retriable = false // Budget exceeded is not retriable without config change
    } else if (error instanceof MissingApiKeyError) {
      errorCode = 'MISSING_API_KEY'
      retriable = false
    } else if (error instanceof LlmError) {
      errorCode = error.code
      retriable = true
    }

    const errorJson = JSON.stringify({
      code: errorCode,
      message: errorMessage,
      at: new Date().toISOString(),
      retriable,
    })

    // Capture partial tokens/cost if segments ran before failure
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: errorJson,
        tokensIn: totalTokensIn > 0 ? totalTokensIn : null,
        tokensOut: totalTokensOut > 0 ? totalTokensOut : null,
        costUsd: totalCostUsd > 0 ? totalCostUsd : null,
      },
    })

    return {
      dayDate,
      status: 'failed',
      attempt: updatedJob.attempt,
      tokensIn: totalTokensIn > 0 ? totalTokensIn : null,
      tokensOut: totalTokensOut > 0 ? totalTokensOut : null,
      costUsd: totalCostUsd > 0 ? totalCostUsd : null,
      error: errorMessage,
    }
  }
}

/**
 * Gets progress counts for a run.
 */
async function getProgress(runId: string): Promise<TickResult['progress']> {
  const counts = await prisma.job.groupBy({
    by: ['status'],
    where: { runId },
    _count: true,
  })

  const progress = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  }

  for (const count of counts) {
    const key = count.status.toLowerCase() as keyof typeof progress
    progress[key] = count._count
  }

  return progress
}

/**
 * Determines run status based on job progress (SPEC §7.4.1).
 */
function determineRunStatus(progress: TickResult['progress']): RunStatus {
  const { running, queued, succeeded, failed, cancelled } = progress

  // Any jobs actively running → RUNNING
  if (running > 0) return 'RUNNING'

  // Jobs still queued: RUNNING if any work has been done, QUEUED if none yet
  if (queued > 0) {
    return (succeeded + failed + cancelled) > 0 ? 'RUNNING' : 'QUEUED'
  }

  // All jobs terminal (no queued, no running)
  if (failed > 0) return 'FAILED'
  if (succeeded > 0) return 'COMPLETED'

  // Defensive fallback (no jobs, or all cancelled — shouldn't happen in practice)
  return 'QUEUED'
}

function buildTickResult(
  runId: string,
  jobs: TickResult['jobs'],
  progress: TickResult['progress'],
  runStatus: string
): TickResult {
  return {
    runId,
    processed: jobs.length,
    jobs,
    progress,
    runStatus,
  }
}

function formatDate(d: Date): string {
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
