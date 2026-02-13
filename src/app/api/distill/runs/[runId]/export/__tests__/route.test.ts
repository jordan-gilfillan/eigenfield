/**
 * Route-level tests for POST /api/distill/runs/:runId/export
 *
 * AUD-065: Verifies full export pipeline (orchestrator → renderer → writer)
 * and error mapping (ExportPreconditionError → HTTP status codes).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { POST } from '../route'
import { prisma } from '@/lib/db'

const TEST_PREFIX = 'exp-rt'

let batchId: string
let filterProfileId: string
let completedRunId: string
let runningRunId: string
let tempDir: string

beforeAll(async () => {
  // ImportBatch
  const batch = await prisma.importBatch.create({
    data: {
      id: `${TEST_PREFIX}-batch`,
      source: 'CHATGPT',
      originalFilename: 'chatgpt.json',
      fileSizeBytes: 100,
      timezone: 'America/New_York',
      statsJson: { message_count: 2, day_count: 1, coverage_start: '2025-01-15', coverage_end: '2025-01-15' },
    },
  })
  batchId = batch.id

  // Prompts
  const cp = await prisma.prompt.create({
    data: { id: `${TEST_PREFIX}-cp`, stage: 'CLASSIFY', name: `${TEST_PREFIX}-classify` },
  })
  const cpv = await prisma.promptVersion.create({
    data: { id: `${TEST_PREFIX}-cpv`, promptId: cp.id, versionLabel: 'v1', templateText: 'classify', isActive: true },
  })
  const sp = await prisma.prompt.create({
    data: { id: `${TEST_PREFIX}-sp`, stage: 'SUMMARIZE', name: `${TEST_PREFIX}-summarize` },
  })
  const spv = await prisma.promptVersion.create({
    data: { id: `${TEST_PREFIX}-spv`, promptId: sp.id, versionLabel: 'v1', templateText: 'summarize', isActive: true },
  })

  // FilterProfile
  await prisma.filterProfile.create({
    data: { id: `${TEST_PREFIX}-fp`, name: `${TEST_PREFIX}-fp`, mode: 'INCLUDE', categories: ['WORK'] },
  })
  filterProfileId = `${TEST_PREFIX}-fp`

  const configJson = {
    promptVersionIds: { summarize: spv.id, classify: cpv.id },
    labelSpec: { model: 'gpt-4o-mini', promptVersionId: cpv.id },
    filterProfileSnapshot: { name: `${TEST_PREFIX}-fp`, mode: 'include', categories: ['work'] },
    timezone: 'America/New_York',
    maxInputTokens: 100000,
    importBatchIds: [batchId],
  }

  // COMPLETED Run with 1 SUCCEEDED job + 1 SUMMARIZE output
  const completedRun = await prisma.run.create({
    data: {
      id: `${TEST_PREFIX}-run-ok`,
      status: 'COMPLETED',
      importBatchId: batchId,
      filterProfileId,
      model: 'gpt-4o-mini',
      sources: ['CHATGPT'],
      startDate: new Date('2025-01-15'),
      endDate: new Date('2025-01-15'),
      outputTarget: 'db',
      configJson,
    },
  })
  completedRunId = completedRun.id

  await prisma.runBatch.create({
    data: { runId: completedRunId, importBatchId: batchId },
  })

  const job = await prisma.job.create({
    data: {
      id: `${TEST_PREFIX}-job1`,
      runId: completedRunId,
      dayDate: new Date('2025-01-15'),
      status: 'SUCCEEDED',
      attempt: 1,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
    },
  })

  await prisma.output.create({
    data: {
      id: `${TEST_PREFIX}-out1`,
      jobId: job.id,
      stage: 'SUMMARIZE',
      outputText: '# January 15\n\nA productive day.',
      bundleHash: 'a'.repeat(64),
      bundleContextHash: 'b'.repeat(64),
      outputJson: { meta: { segmented: false } },
      model: 'gpt-4o-mini',
      promptVersionId: spv.id,
    },
  })

  // RUNNING Run (for precondition failure test)
  const runningRun = await prisma.run.create({
    data: {
      id: `${TEST_PREFIX}-run-running`,
      status: 'RUNNING',
      importBatchId: batchId,
      filterProfileId,
      model: 'gpt-4o-mini',
      sources: ['CHATGPT'],
      startDate: new Date('2025-01-15'),
      endDate: new Date('2025-01-15'),
      outputTarget: 'db',
      configJson,
    },
  })
  runningRunId = runningRun.id

  await prisma.runBatch.create({
    data: { runId: runningRunId, importBatchId: batchId },
  })
})

afterAll(async () => {
  // Clean up in reverse dependency order
  await prisma.output.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
  await prisma.job.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
  await prisma.runBatch.deleteMany({ where: { runId: { startsWith: TEST_PREFIX } } })
  await prisma.run.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
  await prisma.promptVersion.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
  await prisma.prompt.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
  await prisma.filterProfile.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
  await prisma.importBatch.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
})

function makeRequest(runId: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    new URL(`http://localhost/api/distill/runs/${runId}/export`),
    { method: 'POST', body: JSON.stringify(body) },
  )
}

describe('POST /api/distill/runs/:runId/export', () => {
  it('exports a COMPLETED run and writes files to disk', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'export-route-'))

    const res = await POST(
      makeRequest(completedRunId, { outputDir: tempDir }),
      { params: Promise.resolve({ runId: completedRunId }) },
    )

    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(json.outputDir).toBe(tempDir)
    expect(json.fileCount).toBeGreaterThanOrEqual(4) // README, timeline, 1 day view, manifest
    expect(json.files).toContain('README.md')
    expect(json.files).toContain('views/timeline.md')
    expect(json.files).toContain('views/2025-01-15.md')
    expect(json.files).toContain('.journal-meta/manifest.json')

    // Verify files actually written to disk
    const readme = await readFile(join(tempDir, 'README.md'), 'utf-8')
    expect(readme).toContain('export_v1')

    const dayView = await readFile(join(tempDir, 'views/2025-01-15.md'), 'utf-8')
    expect(dayView).toContain('A productive day.')
    expect(dayView).toContain('date: "2025-01-15"')

    const manifest = await readFile(join(tempDir, '.journal-meta/manifest.json'), 'utf-8')
    const manifestJson = JSON.parse(manifest)
    expect(manifestJson.exportedAt).toBe(json.exportedAt)
    expect(manifestJson.formatVersion).toBe('export_v1')

    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns 404 for unknown runId', async () => {
    const res = await POST(
      makeRequest('nonexistent-run-id', { outputDir: '/tmp/unused' }),
      { params: Promise.resolve({ runId: 'nonexistent-run-id' }) },
    )

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error.code).toBe('EXPORT_NOT_FOUND')
  })

  it('returns 400 for Run not COMPLETED', async () => {
    const res = await POST(
      makeRequest(runningRunId, { outputDir: '/tmp/unused' }),
      { params: Promise.resolve({ runId: runningRunId }) },
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('EXPORT_PRECONDITION')
    expect(json.error.details.runStatus).toBe('RUNNING')
  })

  it('returns 400 when outputDir is missing', async () => {
    const res = await POST(
      makeRequest(completedRunId, {}),
      { params: Promise.resolve({ runId: completedRunId }) },
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
    expect(json.error.message).toContain('outputDir')
  })

  it('returns 400 when outputDir is not a string', async () => {
    const res = await POST(
      makeRequest(completedRunId, { outputDir: 123 }),
      { params: Promise.resolve({ runId: completedRunId }) },
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
  })

  it('re-export overwrites existing files (idempotent)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'export-route-idem-'))

    // Export twice
    const res1 = await POST(
      makeRequest(completedRunId, { outputDir: tempDir }),
      { params: Promise.resolve({ runId: completedRunId }) },
    )
    expect(res1.status).toBe(200)

    const res2 = await POST(
      makeRequest(completedRunId, { outputDir: tempDir }),
      { params: Promise.resolve({ runId: completedRunId }) },
    )
    expect(res2.status).toBe(200)

    // Files exist and are valid after second export
    const readme = await readFile(join(tempDir, 'README.md'), 'utf-8')
    expect(readme).toContain('export_v1')

    // Only expected directories present (no duplicates)
    const topLevel = await readdir(tempDir)
    expect(topLevel.sort()).toEqual(['.journal-meta', 'README.md', 'atoms', 'views'])

    await rm(tempDir, { recursive: true, force: true })
  })
})
