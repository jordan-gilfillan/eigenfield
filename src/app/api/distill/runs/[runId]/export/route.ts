/**
 * POST /api/distill/runs/:runId/export
 *
 * Exports a completed Run as a deterministic directory of markdown files.
 * Pipeline: buildExportInput → renderExportTree → writeExportTree.
 *
 * Spec reference: §14 (Git Export)
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildExportInput, ExportPreconditionError } from '@/lib/export/orchestrator'
import { renderExportTree } from '@/lib/export/renderer'
import { ExportPathValidationError, resolveExportOutputDir, writeExportTree } from '@/lib/export/writer'
import { errors, errorResponse } from '@/lib/api-utils'
import type { PrivacyTier, PreviousManifest } from '@/lib/export/types'

interface ExportRequest {
  outputDir: string
  privacyTier?: PrivacyTier
  topicVersion?: string
  previousManifest?: PreviousManifest
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params
    const body = (await request.json().catch(() => ({}))) as Partial<ExportRequest>

    if (typeof body.outputDir !== 'string') {
      return errors.invalidInput('outputDir is required')
    }

    if (body.privacyTier !== undefined && body.privacyTier !== 'public' && body.privacyTier !== 'private') {
      return errors.invalidInput('privacyTier must be "public" or "private"')
    }

    if (body.topicVersion !== undefined && body.topicVersion !== 'topic_v1') {
      return errors.invalidInput('topicVersion must be "topic_v1"')
    }

    const exportedAt = new Date().toISOString()

    // 1. Load + validate from DB
    const exportInput = await buildExportInput(runId, exportedAt, {
      privacyTier: body.privacyTier,
      topicVersion: body.topicVersion,
      previousManifest: body.previousManifest,
    })

    // 2. Render in-memory file tree
    const tree = renderExportTree(exportInput)

    // 3. Resolve to sandboxed output directory + write to disk
    const resolvedOutputDir = await resolveExportOutputDir(body.outputDir)
    await writeExportTree(tree, resolvedOutputDir)

    return NextResponse.json({
      exportedAt,
      outputDir: resolvedOutputDir,
      fileCount: tree.size,
      files: [...tree.keys()],
    })
  } catch (error) {
    if (error instanceof ExportPathValidationError) {
      return errors.invalidInput(error.message)
    }

    if (error instanceof ExportPreconditionError) {
      if (error.code === 'EXPORT_NOT_FOUND') {
        return errorResponse(404, error.code, error.message, error.details)
      }
      return errorResponse(400, error.code, error.message, error.details)
    }

    console.error('Export error:', error)
    return errors.internal()
  }
}
