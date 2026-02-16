/**
 * Export DB orchestrator
 *
 * Loads a completed Run's data from Postgres, validates §14.7 preconditions,
 * and maps DB records to ExportInput for the pure renderer.
 *
 * Spec reference: §14.7 (Preconditions)
 */

import { prisma } from '@/lib/db'
import { formatDate } from '@/lib/date-utils'
import type { ExportInput, ExportDay, ExportAtom, PrivacyTier, PreviousManifest } from './types'
import { parseRunConfig } from '@/lib/types/run-config'

// ── Options ─────────────────────────────────────────────────────────────────

export interface BuildExportOptions {
  privacyTier?: PrivacyTier
  topicVersion?: string            // 'topic_v1' → v2 mode; undefined → v1 mode
  previousManifest?: PreviousManifest  // for changelog (§14.14)
}

// ── Error class ──────────────────────────────────────────────────────────────

export class ExportPreconditionError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ExportPreconditionError'
    this.code = code
    this.details = details
  }
}

// ── Main function ────────────────────────────────────────────────────────────

/**
 * Loads a Run and its associated data from the DB, validates §14.7
 * preconditions, and returns a well-formed ExportInput.
 *
 * @param runId - The Run to export
 * @param exportedAt - ISO 8601 timestamp, caller-supplied for determinism
 * @param options - Optional: privacyTier, topicVersion, previousManifest
 * @throws ExportPreconditionError with code EXPORT_NOT_FOUND if Run doesn't exist
 * @throws ExportPreconditionError with code EXPORT_PRECONDITION if preconditions fail
 */
export async function buildExportInput(
  runId: string,
  exportedAt: string,
  options?: BuildExportOptions,
): Promise<ExportInput> {
  const { privacyTier, topicVersion, previousManifest } = options ?? {}
  // 1. Load Run with all related data in a single query
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      runBatches: {
        include: { importBatch: true },
      },
      jobs: {
        orderBy: { dayDate: 'asc' },
        include: {
          outputs: { where: { stage: 'SUMMARIZE' } },
        },
      },
    },
  })

  if (!run) {
    throw new ExportPreconditionError(
      'EXPORT_NOT_FOUND',
      `Run "${runId}" not found`,
    )
  }

  // 2. Validate Run status === COMPLETED
  if (run.status !== 'COMPLETED') {
    throw new ExportPreconditionError(
      'EXPORT_PRECONDITION',
      `Run "${runId}" status is ${run.status}, expected COMPLETED`,
      { runStatus: run.status },
    )
  }

  // 3. Validate all jobs are SUCCEEDED
  const failedJobs = run.jobs.filter((j) => j.status !== 'SUCCEEDED')
  if (failedJobs.length > 0) {
    throw new ExportPreconditionError(
      'EXPORT_PRECONDITION',
      `Run "${runId}" has ${failedJobs.length} non-SUCCEEDED job(s)`,
      {
        failedJobs: failedJobs.map((j) => ({
          jobId: j.id,
          dayDate: formatDate(j.dayDate),
          status: j.status,
        })),
      },
    )
  }

  // 4. Validate each SUCCEEDED job has exactly 1 SUMMARIZE output
  for (const job of run.jobs) {
    if (job.outputs.length === 0) {
      throw new ExportPreconditionError(
        'EXPORT_PRECONDITION',
        `Job "${job.id}" (${formatDate(job.dayDate)}) has no SUMMARIZE output`,
        { jobId: job.id, dayDate: formatDate(job.dayDate), outputCount: 0 },
      )
    }
    if (job.outputs.length > 1) {
      throw new ExportPreconditionError(
        'EXPORT_PRECONDITION',
        `Job "${job.id}" (${formatDate(job.dayDate)}) has ${job.outputs.length} SUMMARIZE outputs, expected 1`,
        { jobId: job.id, dayDate: formatDate(job.dayDate), outputCount: job.outputs.length },
      )
    }
  }

  // 5. Extract frozen config
  const config = parseRunConfig(run.configJson)

  // 6. Map to ExportInput
  const days: ExportDay[] = run.jobs.map((job) => {
    const output = job.outputs[0]
    const meta = (output.outputJson as { meta: { segmented: boolean; segmentCount?: number } }).meta

    const day: ExportDay = {
      dayDate: formatDate(job.dayDate),
      outputText: output.outputText,
      createdAt: output.createdAt.toISOString(),
      bundleHash: output.bundleHash,
      bundleContextHash: output.bundleContextHash,
      segmented: meta.segmented,
    }

    if (meta.segmented && meta.segmentCount !== undefined) {
      day.segmentCount = meta.segmentCount
    }

    return day
  })

  // 7. Load user-role atoms for all days in §9.1 order
  // Private tier always loads atoms. V2 mode also loads atoms (for topic computation)
  // even in public tier — topics/ files are present in both tiers (§14.10).
  const effectiveTier = privacyTier ?? 'private'
  const needAtoms = effectiveTier === 'private' || topicVersion !== undefined
  const batchIds = run.runBatches.map((rb) => rb.importBatchId)
  const dayDates = run.jobs.map((j) => j.dayDate)

  if (needAtoms && dayDates.length > 0 && batchIds.length > 0) {
    const rawAtoms = await prisma.messageAtom.findMany({
      where: {
        importBatchId: { in: batchIds },
        role: 'USER',
        dayDate: { in: dayDates },
      },
      orderBy: [
        { dayDate: 'asc' },
        { source: 'asc' },
        { timestampUtc: 'asc' },
        { atomStableId: 'asc' },
      ],
      select: {
        id: true,
        atomStableId: true,
        source: true,
        timestampUtc: true,
        text: true,
        dayDate: true,
      },
    })

    // Cross-batch dedup by atomStableId (keep first occurrence per §9.1)
    const seen = new Set<string>()
    const dedupedAtoms = rawAtoms.filter((a) => {
      if (seen.has(a.atomStableId)) return false
      seen.add(a.atomStableId)
      return true
    })

    // 8. For v2 mode: query MessageLabel to get each atom's category (§14.11)
    const categoryMap = new Map<string, string>()
    if (topicVersion && dedupedAtoms.length > 0) {
      const atomDbIds = dedupedAtoms.map((a) => a.id)
      const labels = await prisma.messageLabel.findMany({
        where: {
          messageAtomId: { in: atomDbIds },
          model: config.labelSpec.model,
          promptVersionId: config.labelSpec.promptVersionId,
        },
        select: {
          messageAtomId: true,
          category: true,
        },
      })
      for (const label of labels) {
        categoryMap.set(label.messageAtomId, label.category.toLowerCase())
      }
    }

    // Group by dayDate and map to ExportAtom
    const atomsByDay = new Map<string, ExportAtom[]>()
    for (const atom of dedupedAtoms) {
      const dayStr = formatDate(atom.dayDate)
      if (!atomsByDay.has(dayStr)) atomsByDay.set(dayStr, [])
      const exportAtom: ExportAtom = {
        source: atom.source.toLowerCase(),
        timestampUtc: atom.timestampUtc.toISOString(),
        text: atom.text,
        atomStableId: atom.atomStableId,
      }
      const category = categoryMap.get(atom.id)
      if (category) {
        exportAtom.category = category
      }
      atomsByDay.get(dayStr)!.push(exportAtom)
    }

    for (const day of days) {
      day.atoms = atomsByDay.get(day.dayDate) ?? []
    }
  } else {
    for (const day of days) {
      day.atoms = []
    }
  }

  return {
    run: {
      id: run.id,
      model: run.model,
      startDate: formatDate(run.startDate),
      endDate: formatDate(run.endDate),
      sources: (run.sources as string[]).map((s) => s.toLowerCase()),
      timezone: config.timezone,
      filterProfile: {
        name: config.filterProfileSnapshot.name,
        mode: config.filterProfileSnapshot.mode,
        categories: config.filterProfileSnapshot.categories,
      },
    },
    batches: run.runBatches.map((rb) => ({
      id: rb.importBatch.id,
      source: rb.importBatch.source.toLowerCase(),
      originalFilename: rb.importBatch.originalFilename,
      timezone: rb.importBatch.timezone,
    })),
    days,
    exportedAt,
    ...(privacyTier ? { privacyTier } : {}),
    ...(topicVersion ? { topicVersion } : {}),
    ...(previousManifest ? { previousManifest } : {}),
  }
}

