/**
 * Shared types used by dashboard and run detail pages.
 */

export interface LastClassifyStats {
  hasStats: boolean
  stats?: {
    status: 'running' | 'succeeded' | 'failed'
    totalAtoms: number
    processedAtoms: number
    newlyLabeled: number
    skippedAlreadyLabeled: number
    skippedBadOutput: number
    aliasedCount: number
    labeledTotal: number
    tokensIn: number | null
    tokensOut: number | null
    costUsd: number | null
    mode: string
    errorJson: {
      code: string
      message: string
      details?: Record<string, unknown>
    } | null
    lastAtomStableIdProcessed: string | null
    startedAt: string
    finishedAt: string | null
    createdAt: string
  }
}
