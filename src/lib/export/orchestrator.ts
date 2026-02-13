/**
 * Export DB orchestrator
 *
 * Loads a completed Run's data from Postgres, validates §14.7 preconditions,
 * and maps DB records to ExportInput for the pure renderer.
 *
 * Spec reference: §14.7 (Preconditions)
 */

import { prisma } from '@/lib/db'
import type { ExportInput, ExportDay } from './types'

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

// ── Config shape (frozen in Run.configJson) ──────────────────────────────────

interface RunConfig {
  filterProfileSnapshot: {
    name: string
    mode: string
    categories: string[]
  }
  timezone: string
}

// ── Main function ────────────────────────────────────────────────────────────

/**
 * Loads a Run and its associated data from the DB, validates §14.7
 * preconditions, and returns a well-formed ExportInput.
 *
 * @param runId - The Run to export
 * @param exportedAt - ISO 8601 timestamp, caller-supplied for determinism
 * @throws ExportPreconditionError with code EXPORT_NOT_FOUND if Run doesn't exist
 * @throws ExportPreconditionError with code EXPORT_PRECONDITION if preconditions fail
 */
export async function buildExportInput(
  runId: string,
  exportedAt: string,
): Promise<ExportInput> {
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
  const config = run.configJson as unknown as RunConfig

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
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
