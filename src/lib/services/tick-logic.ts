import type { RunStatus } from '@prisma/client'

export interface ProgressCounts {
  queued: number
  running: number
  succeeded: number
  failed: number
  cancelled: number
}

/**
 * Determines run status based on job progress (SPEC §7.4.1).
 */
export function determineRunStatus(progress: ProgressCounts): RunStatus {
  const { running, queued, succeeded, failed, cancelled } = progress

  // Any jobs actively running → RUNNING
  if (running > 0) return 'RUNNING'

  // Jobs still queued: RUNNING if any work has been done, QUEUED if none yet
  if (queued > 0) {
    return (succeeded + failed + cancelled) > 0 ? 'RUNNING' : 'QUEUED'
  }

  // All jobs terminal (no queued, no running)
  if (failed > 0) return 'FAILED'
  if (succeeded > 0) return 'COMPLETED'

  // Defensive fallback (no jobs, or all cancelled — shouldn't happen in practice)
  return 'QUEUED'
}
