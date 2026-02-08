/**
 * GET /api/distill/classify-runs/:id
 *
 * Read-only status endpoint for a specific ClassifyRun.
 * Used by foreground polling to track classify progress.
 * Does NOT trigger classification or mutate state.
 *
 * Spec reference: 7.2.1, 7.8
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { errors } from '@/lib/api-utils'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const classifyRun = await prisma.classifyRun.findUnique({
      where: { id },
    })

    if (!classifyRun) {
      return errors.notFound('ClassifyRun')
    }

    return NextResponse.json({
      id: classifyRun.id,
      importBatchId: classifyRun.importBatchId,
      labelSpec: {
        model: classifyRun.model,
        promptVersionId: classifyRun.promptVersionId,
      },
      mode: classifyRun.mode,
      status: classifyRun.status,
      totals: {
        messageAtoms: classifyRun.totalAtoms,
        labeled: classifyRun.labeledTotal,
        newlyLabeled: classifyRun.newlyLabeled,
        skippedAlreadyLabeled: classifyRun.skippedAlreadyLabeled,
      },
      progress: {
        processedAtoms: classifyRun.processedAtoms,
        totalAtoms: classifyRun.totalAtoms,
      },
      usage: {
        tokensIn: classifyRun.tokensIn,
        tokensOut: classifyRun.tokensOut,
        costUsd: classifyRun.costUsd,
      },
      warnings: {
        skippedBadOutput: classifyRun.skippedBadOutput,
        aliasedCount: classifyRun.aliasedCount,
      },
      lastError: classifyRun.errorJson,
      createdAt: classifyRun.createdAt.toISOString(),
      updatedAt: classifyRun.updatedAt.toISOString(),
      startedAt: classifyRun.startedAt.toISOString(),
      finishedAt: classifyRun.finishedAt?.toISOString() ?? null,
    })
  } catch (error) {
    console.error('Classify run status error:', error)
    return errors.internal()
  }
}
