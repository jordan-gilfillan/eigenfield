/**
 * Tick Service
 *
 * Processes jobs for a run, one at a time with advisory lock protection.
 *
 * Spec references: 7.4 (Process tick loop), 6.9 (Job), 6.10 (Output)
 */

import { prisma } from '../db'
import { withLock } from './advisory-lock'
import { buildBundle, estimateTokens } from './bundle'
import { summarize } from './summarizer'
import type { JobStatus, RunStatus } from '@prisma/client'

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
 * @throws Error with code TICK_IN_PROGRESS if another tick is running
 * @throws Error if run not found
 */
export async function processTick(options: TickOptions): Promise<TickResult> {
  const { runId, maxJobs = DEFAULT_JOBS_PER_TICK } = options

  // Verify run exists
  const run = await prisma.run.findUnique({
    where: { id: runId },
  })
  if (!run) {
    throw new Error(`Run not found: ${runId}`)
  }

  // Execute with advisory lock
  return withLock(runId, async () => {
    // Re-fetch run inside lock to get latest status
    const currentRun = await prisma.run.findUnique({
      where: { id: runId },
    })

    if (!currentRun) {
      throw new Error(`Run not found: ${runId}`)
    }

    // Check terminal status per spec 7.6
    if (currentRun.status === 'CANCELLED') {
      return buildTickResult(runId, [], await getProgress(runId), 'cancelled')
    }

    // Get config from run
    const config = currentRun.configJson as {
      promptVersionIds: { summarize: string }
      labelSpec: { model: string; promptVersionId: string }
      filterProfileSnapshot: { name: string; mode: string; categories: string[] }
      timezone: string
      maxInputTokens: number
    }

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

    // Process each job
    const processedJobs: TickResult['jobs'] = []

    for (const job of queuedJobs) {
      const jobResult = await processJob(job.id, {
        importBatchId: currentRun.importBatchId,
        sources: (currentRun.sources as string[]).map((s) => s.toLowerCase()),
        model: currentRun.model,
        config,
      })
      processedJobs.push(jobResult)
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
    importBatchId: string
    sources: string[]
    model: string
    config: {
      promptVersionIds: { summarize: string }
      labelSpec: { model: string; promptVersionId: string }
      filterProfileSnapshot: { name: string; mode: string; categories: string[] }
      maxInputTokens: number
    }
  }
): Promise<TickResult['jobs'][0]> {
  const { importBatchId, sources, model, config } = context

  // Mark job as running
  const job = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
    },
  })

  const dayDate = formatDate(job.dayDate)

  try {
    // 1. Build bundle
    const bundle = await buildBundle({
      importBatchId,
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

    // For Phase 4 minimal, we skip segmentation and just warn
    // Full segmentation comes in "Phase 4 continued"
    if (needsSegmentation) {
      console.warn(
        `Bundle for ${dayDate} exceeds maxInputTokens (${estimatedTokens} > ${config.maxInputTokens}). ` +
          `Segmentation not yet implemented - processing anyway.`
      )
    }

    // 3. Call summarizer
    const summaryResult = await summarize({
      bundleText: bundle.bundleText,
      model,
      promptVersionId: config.promptVersionIds.summarize,
    })

    // 4. Store output
    await prisma.output.create({
      data: {
        jobId,
        stage: 'SUMMARIZE',
        outputText: summaryResult.text,
        outputJson: {
          meta: {
            segmented: false,
            atomCount: bundle.atomCount,
            estimatedInputTokens: estimatedTokens,
          },
        },
        model,
        promptVersionId: config.promptVersionIds.summarize,
        bundleHash: bundle.bundleHash,
        bundleContextHash: bundle.bundleContextHash,
      },
    })

    // 5. Update job as succeeded
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        tokensIn: summaryResult.tokensIn,
        tokensOut: summaryResult.tokensOut,
        costUsd: summaryResult.costUsd,
      },
    })

    return {
      dayDate,
      status: 'succeeded',
      attempt: updatedJob.attempt,
      tokensIn: summaryResult.tokensIn,
      tokensOut: summaryResult.tokensOut,
      costUsd: summaryResult.costUsd,
      error: null,
    }
  } catch (error) {
    // Mark job as failed
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorJson = JSON.stringify({
      code: 'PROCESSING_ERROR',
      message: errorMessage,
      at: new Date().toISOString(),
      retriable: true,
    })

    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: errorJson,
      },
    })

    return {
      dayDate,
      status: 'failed',
      attempt: updatedJob.attempt,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
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
 * Determines run status based on job progress.
 */
function determineRunStatus(progress: TickResult['progress']): RunStatus {
  if (progress.running > 0) {
    return 'RUNNING'
  }
  if (progress.queued > 0) {
    return 'QUEUED'
  }
  if (progress.failed > 0 && progress.succeeded === 0) {
    return 'FAILED'
  }
  if (progress.succeeded > 0 && progress.failed === 0 && progress.queued === 0) {
    return 'COMPLETED'
  }
  // Mixed state: some succeeded, some failed, none queued/running
  if (progress.succeeded > 0 && progress.failed > 0) {
    return 'FAILED' // Treat partial failure as failed
  }
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
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
