/**
 * GET /api/distill/runs/:runId/jobs/:dayDate/input
 *
 * Returns the input bundle preview for a specific job (day).
 * Reuses the same bundle construction logic (buildBundle) used by tick/job execution
 * so preview content + hashes align with Output.bundleHash / Output.bundleContextHash.
 *
 * Spec reference: 10.2 (Run inspector), PR-6.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { errors } from '@/lib/api-utils'
import { buildBundle } from '@/lib/services/bundle'

interface RunConfig {
  promptVersionIds: { summarize: string }
  labelSpec: { model: string; promptVersionId: string }
  filterProfileSnapshot: { name: string; mode: string; categories: string[] }
  timezone: string
  maxInputTokens: number
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; dayDate: string }> }
) {
  try {
    const { runId, dayDate } = await params

    // Validate runId exists and get frozen config + canonical batch IDs
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: {
        id: true,
        sources: true,
        configJson: true,
        runBatches: { select: { importBatchId: true } },
      },
    })

    if (!run) {
      return errors.notFound('Run')
    }

    // Find job for this run+day (validates dayDate is part of the run)
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

    // Extract frozen config from run
    const config = run.configJson as unknown as RunConfig & { importBatchIds?: string[] }
    const sources = (run.sources as string[]).map((s) => s.toLowerCase())

    // Resolve importBatchIds from RunBatch junction (canonical source per §6.8a),
    // falling back to frozen configJson.importBatchIds for backward compat
    const importBatchIds = run.runBatches.length > 0
      ? run.runBatches.map((rb) => rb.importBatchId)
      : config.importBatchIds ?? []

    // Build bundle using the SAME logic as tick/job execution
    // This guarantees preview content + hashes match what the job actually used
    const bundle = await buildBundle({
      importBatchIds,
      dayDate,
      sources,
      labelSpec: config.labelSpec,
      filterProfile: config.filterProfileSnapshot,
    })

    if (bundle.atomCount === 0) {
      return NextResponse.json({
        hasInput: false,
        runId,
        dayDate,
        bundlePreviewText: null,
        bundleHash: bundle.bundleHash,
        bundleContextHash: bundle.bundleContextHash,
        atomCount: 0,
        rawBundleJson: null,
      })
    }

    // Build structured preview items for display
    const previewItems = bundle.atoms.map((a) => ({
      atomStableId: a.atomStableId,
      source: a.source.toLowerCase(),
      timestampUtc: a.timestampUtc instanceof Date ? a.timestampUtc.toISOString() : a.timestampUtc,
      role: a.role.toLowerCase(),
      text: a.text,
    }))

    return NextResponse.json({
      hasInput: true,
      runId,
      dayDate,
      bundlePreviewText: bundle.bundleText,
      bundleHash: bundle.bundleHash,
      bundleContextHash: bundle.bundleContextHash,
      atomCount: bundle.atomCount,
      previewItems,
      rawBundleJson: {
        bundleText: bundle.bundleText,
        bundleHash: bundle.bundleHash,
        bundleContextHash: bundle.bundleContextHash,
        atomCount: bundle.atomCount,
        atomIds: bundle.atomIds,
      },
    })
  } catch (error) {
    console.error('Get job input error:', error)
    return errors.internal()
  }
}
