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

    // Get token/cost totals from completed jobs
    const totals = await prisma.job.aggregate({
      where: { runId, status: 'SUCCEEDED' },
      _sum: {
        tokensIn: true,
        tokensOut: true,
        costUsd: true,
      },
    })

    const config = run.configJson as {
      promptVersionIds: { summarize: string }
      labelSpec: { model: string; promptVersionId: string }
      filterProfileSnapshot: { name: string; mode: string; categories: string[] }
      timezone: string
      maxInputTokens: number
    }

    return NextResponse.json({
      id: run.id,
      status: run.status.toLowerCase(),
      importBatchId: run.importBatchId,
      model: run.model,
      sources: run.sources,
      startDate: run.startDate,
      endDate: run.endDate,
      config: {
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
      createdAt: run.createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Get run error:', error)
    return errors.internal()
  }
}
