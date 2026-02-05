/**
 * GET /api/distill/runs/:runId/jobs/:dayDate/output
 *
 * Returns output data for a specific job (day).
 * Used by the Output viewer to render markdown and display inspector metadata.
 *
 * Spec reference: 7.5.1 (Output viewer + inspector metadata)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { errors } from '@/lib/api-utils'

interface OutputMeta {
  segmented?: boolean
  segmentCount?: number
  segmentIds?: string[]
  atomCount?: number
  estimatedInputTokens?: number
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; dayDate: string }> }
) {
  try {
    const { runId, dayDate } = await params

    // Validate runId exists
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: { id: true },
    })

    if (!run) {
      return errors.notFound('Run')
    }

    // Find job for this run+day
    const job = await prisma.job.findFirst({
      where: {
        runId,
        dayDate: new Date(dayDate),
      },
      select: {
        id: true,
        status: true,
      },
    })

    if (!job) {
      return errors.notFound('Job')
    }

    // Find output for this job (summarize stage)
    const output = await prisma.output.findFirst({
      where: {
        jobId: job.id,
        stage: 'SUMMARIZE',
      },
      select: {
        id: true,
        stage: true,
        outputText: true,
        outputJson: true,
        model: true,
        promptVersionId: true,
        bundleHash: true,
        bundleContextHash: true,
        createdAt: true,
      },
    })

    if (!output) {
      // Job exists but no output yet (not processed or failed)
      return NextResponse.json({
        runId,
        dayDate,
        jobStatus: job.status.toLowerCase(),
        hasOutput: false,
        output: null,
      })
    }

    // Extract metadata from outputJson
    const outputJson = output.outputJson as { meta?: OutputMeta } | null
    const meta = outputJson?.meta || {}

    return NextResponse.json({
      runId,
      dayDate,
      jobStatus: job.status.toLowerCase(),
      hasOutput: true,
      output: {
        id: output.id,
        stage: output.stage.toLowerCase(),
        outputText: output.outputText,
        model: output.model,
        promptVersionId: output.promptVersionId,
        bundleHash: output.bundleHash,
        bundleContextHash: output.bundleContextHash,
        createdAt: output.createdAt.toISOString(),
        // Segmentation metadata (spec 7.5.1)
        segmented: meta.segmented ?? false,
        segmentCount: meta.segmentCount ?? null,
        segmentIds: meta.segmentIds ?? null,
        // Additional metadata
        atomCount: meta.atomCount ?? null,
        estimatedInputTokens: meta.estimatedInputTokens ?? null,
        // Raw JSON for collapsible viewer
        rawOutputJson: output.outputJson,
      },
    })
  } catch (error) {
    console.error('Get job output error:', error)
    return errors.internal()
  }
}
