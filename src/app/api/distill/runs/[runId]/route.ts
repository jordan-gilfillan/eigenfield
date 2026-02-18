/**
 * GET /api/distill/runs/:runId
 *
 * Returns run details including job progress.
 *
 * Spec reference: 7.9
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { errors } from '@/lib/api-utils'
import { parseRunConfig } from '@/lib/types/run-config'
import { formatDate } from '@/lib/date-utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params

    const run = await prisma.run.findUnique({
      where: { id: runId },
      include: {
        _count: {
          select: { jobs: true },
        },
        jobs: {
          orderBy: { dayDate: 'asc' },
        },
        runBatches: {
          select: {
            id: true,
            importBatchId: true,
            importBatch: {
              select: { originalFilename: true, source: true },
            },
          },
          orderBy: [
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
        },
      },
    })

    if (!run) {
      return errors.notFound('Run')
    }

    // Get job status counts
    const jobCounts = await prisma.job.groupBy({
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

    for (const count of jobCounts) {
      const key = count.status.toLowerCase() as keyof typeof progress
      progress[key] = count._count
    }

    // Get token/cost totals from all jobs (includes partial usage from failed jobs per SPEC §11.4)
    const totals = await prisma.job.aggregate({
      where: { runId },
      _sum: {
        tokensIn: true,
        tokensOut: true,
        costUsd: true,
      },
    })

    const config = parseRunConfig(run.configJson)

    // Format jobs for response
    const jobs = run.jobs.map((job) => ({
      dayDate: job.dayDate.toISOString().split('T')[0], // YYYY-MM-DD
      status: job.status.toLowerCase(),
      attempt: job.attempt,
      tokensIn: job.tokensIn || 0,
      tokensOut: job.tokensOut || 0,
      costUsd: job.costUsd || 0,
      error: job.error, // JSON string or null
    }))

    return NextResponse.json({
      id: run.id,
      status: run.status.toLowerCase(),
      importBatchId: run.runBatches[0]?.importBatchId ?? run.importBatchId,
      importBatchIds: run.runBatches.map((rb) => rb.importBatchId),
      importBatches: run.runBatches.map((rb) => ({
        id: rb.importBatchId,
        originalFilename: rb.importBatch.originalFilename,
        source: rb.importBatch.source.toLowerCase(),
      })),
      model: run.model,
      sources: (run.sources as string[]).map(s => s.toLowerCase()),
      startDate: formatDate(run.startDate),
      endDate: formatDate(run.endDate),
      config: {
        promptVersionIds: config.promptVersionIds,
        labelSpec: config.labelSpec,
        filterProfile: config.filterProfileSnapshot,
        timezone: config.timezone,
        maxInputTokens: config.maxInputTokens,
      },
      progress,
      totals: {
        jobs: run._count.jobs,
        tokensIn: totals._sum.tokensIn || 0,
        tokensOut: totals._sum.tokensOut || 0,
        costUsd: totals._sum.costUsd || 0,
      },
      jobs,
      createdAt: run.createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Get run error:', error)
    return errors.internal()
  }
}
