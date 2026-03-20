import { describe, expect, it } from 'vitest'
import {
  getImportBatchSources,
  isDuplicateImportResult,
  isReusableImportBatch,
  toDemoImportBatch,
  type DemoImportBatch,
  type DemoImportResult,
} from '@/app/demo/import-batch-utils'

describe('demo import batch utils', () => {
  it('maps a fresh import result into a selected batch with stored counts', () => {
    const result: DemoImportResult = {
      importBatch: {
        id: 'batch-1',
        createdAt: '2026-03-19T10:00:00.000Z',
        source: 'chatgpt',
        originalFilename: 'demo.json',
        fileSizeBytes: 123,
        timezone: 'UTC',
        stats: {
          message_count: 4,
          day_count: 2,
          coverage_start: '2026-03-01',
          coverage_end: '2026-03-02',
          per_source_counts: { chatgpt: 4 },
        },
      },
      created: {
        messageAtoms: 4,
        rawEntries: 2,
      },
      warnings: [],
    }

    expect(toDemoImportBatch(result)).toEqual({
      ...result.importBatch,
      storedCounts: {
        messageAtoms: 4,
        rawEntries: 2,
      },
    })
  })

  it('derives sorted source defaults from per-source counts', () => {
    const batch: DemoImportBatch = {
      id: 'batch-2',
      createdAt: '2026-03-19T10:00:00.000Z',
      source: 'chatgpt',
      originalFilename: 'demo.json',
      fileSizeBytes: 123,
      timezone: 'UTC',
      stats: {
        message_count: 4,
        day_count: 2,
        coverage_start: '2026-03-01',
        coverage_end: '2026-03-02',
        per_source_counts: { grok: 1, chatgpt: 3 },
      },
      storedCounts: {
        messageAtoms: 4,
        rawEntries: 2,
      },
    }

    expect(getImportBatchSources(batch)).toEqual(['chatgpt', 'grok'])
  })

  it('falls back to the batch source when per-source counts are empty', () => {
    const batch: DemoImportBatch = {
      id: 'batch-3',
      createdAt: '2026-03-19T10:00:00.000Z',
      source: 'claude',
      originalFilename: 'demo.json',
      fileSizeBytes: 123,
      timezone: 'UTC',
      stats: {
        message_count: 0,
        day_count: 0,
        coverage_start: '',
        coverage_end: '',
        per_source_counts: {},
      },
      storedCounts: {
        messageAtoms: 0,
        rawEntries: 0,
      },
    }

    expect(getImportBatchSources(batch)).toEqual(['claude'])
  })

  it('flags duplicate imports and empty reusable batches correctly', () => {
    const duplicateResult: DemoImportResult = {
      importBatch: {
        id: 'batch-4',
        createdAt: '2026-03-19T10:00:00.000Z',
        source: 'chatgpt',
        originalFilename: 'demo.json',
        fileSizeBytes: 123,
        timezone: 'UTC',
        stats: {
          message_count: 4,
          day_count: 2,
          coverage_start: '2026-03-01',
          coverage_end: '2026-03-02',
          per_source_counts: { chatgpt: 4 },
        },
      },
      created: {
        messageAtoms: 0,
        rawEntries: 0,
      },
      warnings: ['Skipped 4 duplicate messages (already imported)'],
    }

    expect(isDuplicateImportResult(duplicateResult)).toBe(true)
    expect(
      isReusableImportBatch({
        storedCounts: {
          messageAtoms: 0,
          rawEntries: 0,
        },
      })
    ).toBe(false)
  })
})
