/**
 * GET /api/distill/import-batches/:id/last-classify?model=...&promptVersionId=...
 *
 * Returns the most recent ClassifyRun stats for the given batch + labelSpec.
 * Used by both Dashboard and Run Detail pages (shared shape prevents drift).
 *
 * Spec reference: 7.9
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { errors } from '@/lib/api-utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: importBatchId } = await params
    const { searchParams } = new URL(request.url)
    const model = searchParams.get('model')
    const promptVersionId = searchParams.get('promptVersionId')

    if (!model || !promptVersionId) {
      return errors.invalidInput('model and promptVersionId query params are required')
    }

    // Verify import batch exists
    const batch = await prisma.importBatch.findUnique({
      where: { id: importBatchId },
      select: { id: true },
    })
    if (!batch) {
      return errors.notFound('ImportBatch')
    }

    // Find the most recent ClassifyRun for this batch + labelSpec
    const classifyRun = await prisma.classifyRun.findFirst({
      where: {
        importBatchId,
        model,
        promptVersionId,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!classifyRun) {
      return NextResponse.json({ hasStats: false })
    }

    return NextResponse.json({
      hasStats: true,
      stats: {
        status: classifyRun.status,
        totalAtoms: classifyRun.totalAtoms,
        processedAtoms: classifyRun.processedAtoms,
        newlyLabeled: classifyRun.newlyLabeled,
        skippedAlreadyLabeled: classifyRun.skippedAlreadyLabeled,
        skippedBadOutput: classifyRun.skippedBadOutput,
        aliasedCount: classifyRun.aliasedCount,
        labeledTotal: classifyRun.labeledTotal,
        tokensIn: classifyRun.tokensIn,
        tokensOut: classifyRun.tokensOut,
        costUsd: classifyRun.costUsd,
        mode: classifyRun.mode,
        errorJson: classifyRun.errorJson,
        lastAtomStableIdProcessed: classifyRun.lastAtomStableIdProcessed,
        startedAt: classifyRun.startedAt.toISOString(),
        finishedAt: classifyRun.finishedAt?.toISOString() ?? null,
        createdAt: classifyRun.createdAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('Last classify error:', error)
    return errors.internal()
  }
}
