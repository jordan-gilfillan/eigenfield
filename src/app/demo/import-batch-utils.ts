export interface ImportStats {
  message_count: number
  day_count: number
  coverage_start: string
  coverage_end: string
  per_source_counts: Record<string, number>
}

export interface ImportBatchStoredCounts {
  messageAtoms: number
  rawEntries: number
}

export interface DemoImportBatch {
  id: string
  createdAt: string
  source: string
  originalFilename: string
  fileSizeBytes: number
  timezone: string
  stats: ImportStats
  storedCounts: ImportBatchStoredCounts
}

export interface DemoImportResult {
  importBatch: Omit<DemoImportBatch, 'storedCounts'>
  created: ImportBatchStoredCounts
  warnings: string[]
}

export function getImportBatchSources(batch: Pick<DemoImportBatch, 'stats' | 'source'>): string[] {
  const keys = Object.keys(batch.stats.per_source_counts)
  return (keys.length > 0 ? keys : [batch.source]).map((source) => source.toLowerCase()).sort()
}

export function toDemoImportBatch(result: DemoImportResult): DemoImportBatch {
  return {
    ...result.importBatch,
    storedCounts: {
      messageAtoms: result.created.messageAtoms,
      rawEntries: result.created.rawEntries,
    },
  }
}

export function isDuplicateImportResult(result: DemoImportResult): boolean {
  return result.created.messageAtoms === 0
}

export function isReusableImportBatch(batch: Pick<DemoImportBatch, 'storedCounts'>): boolean {
  return batch.storedCounts.messageAtoms > 0
}
