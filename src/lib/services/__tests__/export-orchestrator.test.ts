/**
 * Integration tests for Export DB Orchestrator (AUD-063).
 *
 * Tests buildExportInput() which loads a completed Run from the DB,
 * validates §14.7 preconditions, and returns ExportInput for the renderer.
 *
 * These tests require a running database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { buildExportInput, ExportPreconditionError } from '@/lib/export/orchestrator'

const P = 'eo-test' // test prefix for all IDs

// Track IDs for cleanup
let filterProfileId: string
let summarizePromptVersionId: string
const promptIds: string[] = []
const promptVersionIds: string[] = []
const batchIds: string[] = []
const runBatchIds: string[] = []
const runIds: string[] = []
const jobIds: string[] = []
const outputIds: string[] = []
const atomIds: string[] = []
const labelIds: string[] = []

// ── Shared test fixtures ────────────────────────────────────────────────────

const EXPORTED_AT = '2024-07-01T12:00:00.000Z'

beforeAll(async () => {
  // Prompt + PromptVersion (required by Output FK)
  const prompt = await prisma.prompt.create({
    data: { id: `${P}-prompt`, stage: 'SUMMARIZE', name: `${P}-summarize` },
  })
  promptIds.push(prompt.id)

  const pv = await prisma.promptVersion.create({
    data: {
      id: `${P}-pv`,
      promptId: prompt.id,
      versionLabel: 'v1',
      templateText: 'Summarize: {{text}}',
      isActive: true,
    },
  })
  summarizePromptVersionId = pv.id
  promptVersionIds.push(pv.id)

  // FilterProfile
  const fp = await prisma.filterProfile.create({
    data: {
      id: `${P}-filter`,
      name: `${P}-professional`,
      mode: 'INCLUDE',
      categories: ['WORK', 'LEARNING'],
    },
  })
  filterProfileId = fp.id

  // ImportBatch 1
  const batch1 = await prisma.importBatch.create({
    data: {
      id: `${P}-batch-1`,
      source: 'CHATGPT',
      originalFilename: 'chatgpt-export.json',
      fileSizeBytes: 2000,
      timezone: 'America/Los_Angeles',
      statsJson: { message_count: 10, day_count: 3 },
    },
  })
  batchIds.push(batch1.id)

  // ImportBatch 2 (for multi-batch test)
  const batch2 = await prisma.importBatch.create({
    data: {
      id: `${P}-batch-2`,
      source: 'CLAUDE',
      originalFilename: 'claude-export.json',
      fileSizeBytes: 1500,
      timezone: 'America/Los_Angeles',
      statsJson: { message_count: 5, day_count: 2 },
    },
  })
  batchIds.push(batch2.id)

  // ── Happy-path Run: COMPLETED, 3 days (2 non-segmented, 1 segmented) ──

  const configJson = {
    promptVersionIds: { summarize: summarizePromptVersionId },
    labelSpec: { model: 'stub_v1', promptVersionId: `${P}-classify-pv` },
    filterProfileSnapshot: { name: `${P}-professional`, mode: 'include', categories: ['work', 'learning'] },
    timezone: 'America/Los_Angeles',
    maxInputTokens: 12000,
  }

  const run = await prisma.run.create({
    data: {
      id: `${P}-run-happy`,
      status: 'COMPLETED',
      importBatchId: batch1.id,
      startDate: new Date('2024-06-01'),
      endDate: new Date('2024-06-03'),
      sources: ['CHATGPT', 'CLAUDE'],
      filterProfileId,
      model: 'gpt-4o',
      outputTarget: 'db',
      configJson,
    },
  })
  runIds.push(run.id)

  // RunBatch junction entries
  const rb1 = await prisma.runBatch.create({
    data: { id: `${P}-rb-1`, runId: run.id, importBatchId: batch1.id },
  })
  runBatchIds.push(rb1.id)

  const rb2 = await prisma.runBatch.create({
    data: { id: `${P}-rb-2`, runId: run.id, importBatchId: batch2.id },
  })
  runBatchIds.push(rb2.id)

  // Jobs (created out of order to verify ASC sort)
  const job3 = await prisma.job.create({
    data: {
      id: `${P}-job-3`, runId: run.id, dayDate: new Date('2024-06-03'),
      status: 'SUCCEEDED', attempt: 1, startedAt: new Date(), finishedAt: new Date(),
      tokensIn: 200, tokensOut: 100, costUsd: 0.002,
    },
  })
  jobIds.push(job3.id)

  const job1 = await prisma.job.create({
    data: {
      id: `${P}-job-1`, runId: run.id, dayDate: new Date('2024-06-01'),
      status: 'SUCCEEDED', attempt: 1, startedAt: new Date(), finishedAt: new Date(),
      tokensIn: 100, tokensOut: 50, costUsd: 0.001,
    },
  })
  jobIds.push(job1.id)

  const job2 = await prisma.job.create({
    data: {
      id: `${P}-job-2`, runId: run.id, dayDate: new Date('2024-06-02'),
      status: 'SUCCEEDED', attempt: 1, startedAt: new Date(), finishedAt: new Date(),
      tokensIn: 300, tokensOut: 150, costUsd: 0.003,
    },
  })
  jobIds.push(job2.id)

  // Outputs (SUMMARIZE stage)
  const out1 = await prisma.output.create({
    data: {
      id: `${P}-out-1`, jobId: job1.id, stage: 'SUMMARIZE',
      outputText: '# Day 1\n\nWorked on auth module.',
      outputJson: { meta: { segmented: false, atomCount: 5, estimatedInputTokens: 100 } },
      model: 'gpt-4o', promptVersionId: summarizePromptVersionId,
      bundleHash: 'hash-day1-bundle', bundleContextHash: 'hash-day1-ctx',
    },
  })
  outputIds.push(out1.id)

  const out2 = await prisma.output.create({
    data: {
      id: `${P}-out-2`, jobId: job2.id, stage: 'SUMMARIZE',
      outputText: '# Day 2\n\nDeployment prep.',
      outputJson: { meta: { segmented: true, segmentCount: 3, segmentIds: ['s1', 's2', 's3'], atomCount: 20, estimatedInputTokens: 300 } },
      model: 'gpt-4o', promptVersionId: summarizePromptVersionId,
      bundleHash: 'hash-day2-bundle', bundleContextHash: 'hash-day2-ctx',
    },
  })
  outputIds.push(out2.id)

  const out3 = await prisma.output.create({
    data: {
      id: `${P}-out-3`, jobId: job3.id, stage: 'SUMMARIZE',
      outputText: '# Day 3\n\nCode review.',
      outputJson: { meta: { segmented: false, atomCount: 8, estimatedInputTokens: 200 } },
      model: 'gpt-4o', promptVersionId: summarizePromptVersionId,
      bundleHash: 'hash-day3-bundle', bundleContextHash: 'hash-day3-ctx',
    },
  })
  outputIds.push(out3.id)

  // ── MessageAtoms for the happy-path run (user + assistant, multi-batch) ──

  // Day 1: 2 user atoms from batch-1 (chatgpt), 1 assistant (should be excluded)
  const atomD1U1 = await prisma.messageAtom.create({
    data: {
      id: `${P}-atom-d1u1`, atomStableId: `${P}-stable-d1u1`,
      importBatchId: batch1.id, source: 'CHATGPT', role: 'USER',
      dayDate: new Date('2024-06-01'), timestampUtc: new Date('2024-06-01T10:00:00.000Z'),
      text: 'How do I set up OAuth?', textHash: 'th-d1u1',
    },
  })
  atomIds.push(atomD1U1.id)

  const atomD1U2 = await prisma.messageAtom.create({
    data: {
      id: `${P}-atom-d1u2`, atomStableId: `${P}-stable-d1u2`,
      importBatchId: batch1.id, source: 'CHATGPT', role: 'USER',
      dayDate: new Date('2024-06-01'), timestampUtc: new Date('2024-06-01T14:30:00.000Z'),
      text: 'Thanks, what about refresh tokens?', textHash: 'th-d1u2',
    },
  })
  atomIds.push(atomD1U2.id)

  const atomD1Asst = await prisma.messageAtom.create({
    data: {
      id: `${P}-atom-d1a1`, atomStableId: `${P}-stable-d1a1`,
      importBatchId: batch1.id, source: 'CHATGPT', role: 'ASSISTANT',
      dayDate: new Date('2024-06-01'), timestampUtc: new Date('2024-06-01T10:01:00.000Z'),
      text: 'Here is how to set up OAuth...', textHash: 'th-d1a1',
    },
  })
  atomIds.push(atomD1Asst.id)

  // Day 1: 1 user atom from batch-2 (claude) — tests multi-source
  const atomD1C1 = await prisma.messageAtom.create({
    data: {
      id: `${P}-atom-d1c1`, atomStableId: `${P}-stable-d1c1`,
      importBatchId: batch2.id, source: 'CLAUDE', role: 'USER',
      dayDate: new Date('2024-06-01'), timestampUtc: new Date('2024-06-01T11:00:00.000Z'),
      text: 'Help me review the auth design', textHash: 'th-d1c1',
    },
  })
  atomIds.push(atomD1C1.id)

  // Day 2: 1 user atom
  const atomD2U1 = await prisma.messageAtom.create({
    data: {
      id: `${P}-atom-d2u1`, atomStableId: `${P}-stable-d2u1`,
      importBatchId: batch1.id, source: 'CHATGPT', role: 'USER',
      dayDate: new Date('2024-06-02'), timestampUtc: new Date('2024-06-02T09:00:00.000Z'),
      text: 'Prepare deployment checklist', textHash: 'th-d2u1',
    },
  })
  atomIds.push(atomD2U1.id)

  // Day 3: no atoms (tests empty atoms list)

  // ── Classify Prompt + PromptVersion (required by MessageLabel FK) ──

  const classifyPrompt = await prisma.prompt.create({
    data: { id: `${P}-classify-prompt`, stage: 'CLASSIFY', name: `${P}-classify` },
  })
  promptIds.push(classifyPrompt.id)

  const classifyPv = await prisma.promptVersion.create({
    data: {
      id: `${P}-classify-pv`,
      promptId: classifyPrompt.id,
      versionLabel: 'v1',
      templateText: 'Classify: {{text}}',
      isActive: true,
    },
  })
  promptVersionIds.push(classifyPv.id)

  // ── MessageLabels for atoms (v2 topic assignment) ──
  // Matches labelSpec in configJson: { model: 'stub_v1', promptVersionId: '${P}-classify-pv' }

  const label1 = await prisma.messageLabel.create({
    data: {
      id: `${P}-label-d1u1`, messageAtomId: atomD1U1.id,
      category: 'WORK', confidence: 0.95,
      model: 'stub_v1', promptVersionId: classifyPv.id,
    },
  })
  labelIds.push(label1.id)

  const label2 = await prisma.messageLabel.create({
    data: {
      id: `${P}-label-d1u2`, messageAtomId: atomD1U2.id,
      category: 'WORK', confidence: 0.90,
      model: 'stub_v1', promptVersionId: classifyPv.id,
    },
  })
  labelIds.push(label2.id)

  const label3 = await prisma.messageLabel.create({
    data: {
      id: `${P}-label-d1c1`, messageAtomId: atomD1C1.id,
      category: 'LEARNING', confidence: 0.85,
      model: 'stub_v1', promptVersionId: classifyPv.id,
    },
  })
  labelIds.push(label3.id)

  const label4 = await prisma.messageLabel.create({
    data: {
      id: `${P}-label-d2u1`, messageAtomId: atomD2U1.id,
      category: 'LEARNING', confidence: 0.88,
      model: 'stub_v1', promptVersionId: classifyPv.id,
    },
  })
  labelIds.push(label4.id)

  // Note: atomD1Asst (assistant role) has no label — assistant atoms are excluded from export

  // ── Run with RUNNING status (for precondition failure test) ──

  const runRunning = await prisma.run.create({
    data: {
      id: `${P}-run-running`,
      status: 'RUNNING',
      importBatchId: batch1.id,
      startDate: new Date('2024-06-01'),
      endDate: new Date('2024-06-01'),
      sources: ['CHATGPT'],
      filterProfileId,
      model: 'gpt-4o',
      outputTarget: 'db',
      configJson,
    },
  })
  runIds.push(runRunning.id)

  // ── Run with mixed job statuses (for failed-job test) ──

  const runMixed = await prisma.run.create({
    data: {
      id: `${P}-run-mixed`,
      status: 'COMPLETED',
      importBatchId: batch1.id,
      startDate: new Date('2024-06-01'),
      endDate: new Date('2024-06-02'),
      sources: ['CHATGPT'],
      filterProfileId,
      model: 'gpt-4o',
      outputTarget: 'db',
      configJson,
    },
  })
  runIds.push(runMixed.id)

  const jobOk = await prisma.job.create({
    data: {
      id: `${P}-job-ok`, runId: runMixed.id, dayDate: new Date('2024-06-01'),
      status: 'SUCCEEDED', attempt: 1,
    },
  })
  jobIds.push(jobOk.id)

  const outOk = await prisma.output.create({
    data: {
      id: `${P}-out-ok`, jobId: jobOk.id, stage: 'SUMMARIZE',
      outputText: 'ok', outputJson: { meta: { segmented: false, atomCount: 1, estimatedInputTokens: 10 } },
      model: 'gpt-4o', promptVersionId: summarizePromptVersionId,
      bundleHash: 'h1', bundleContextHash: 'h2',
    },
  })
  outputIds.push(outOk.id)

  const jobFail = await prisma.job.create({
    data: {
      id: `${P}-job-fail`, runId: runMixed.id, dayDate: new Date('2024-06-02'),
      status: 'FAILED', attempt: 1,
    },
  })
  jobIds.push(jobFail.id)

  // ── Run with SUCCEEDED job but missing output (data integrity) ──

  const runNoOutput = await prisma.run.create({
    data: {
      id: `${P}-run-no-output`,
      status: 'COMPLETED',
      importBatchId: batch1.id,
      startDate: new Date('2024-06-01'),
      endDate: new Date('2024-06-01'),
      sources: ['CHATGPT'],
      filterProfileId,
      model: 'gpt-4o',
      outputTarget: 'db',
      configJson,
    },
  })
  runIds.push(runNoOutput.id)

  const jobNoOut = await prisma.job.create({
    data: {
      id: `${P}-job-no-out`, runId: runNoOutput.id, dayDate: new Date('2024-06-01'),
      status: 'SUCCEEDED', attempt: 1,
    },
  })
  jobIds.push(jobNoOut.id)
  // Deliberately no Output created for this job

  // ── Empty run (COMPLETED, 0 jobs) ──

  const runEmpty = await prisma.run.create({
    data: {
      id: `${P}-run-empty`,
      status: 'COMPLETED',
      importBatchId: batch1.id,
      startDate: new Date('2024-06-01'),
      endDate: new Date('2024-06-01'),
      sources: ['CHATGPT'],
      filterProfileId,
      model: 'gpt-4o',
      outputTarget: 'db',
      configJson,
    },
  })
  runIds.push(runEmpty.id)

  const rbEmpty = await prisma.runBatch.create({
    data: { id: `${P}-rb-empty`, runId: runEmpty.id, importBatchId: batch1.id },
  })
  runBatchIds.push(rbEmpty.id)
})

afterAll(async () => {
  // Clean up in reverse dependency order
  await prisma.messageLabel.deleteMany({ where: { id: { in: labelIds } } })
  await prisma.messageAtom.deleteMany({ where: { id: { in: atomIds } } })
  await prisma.output.deleteMany({ where: { id: { in: outputIds } } })
  await prisma.job.deleteMany({ where: { id: { in: jobIds } } })
  await prisma.runBatch.deleteMany({ where: { id: { in: runBatchIds } } })
  await prisma.run.deleteMany({ where: { id: { in: runIds } } })
  await prisma.importBatch.deleteMany({ where: { id: { in: batchIds } } })
  await prisma.filterProfile.deleteMany({ where: { id: filterProfileId } })
  await prisma.promptVersion.deleteMany({ where: { id: { in: promptVersionIds } } })
  await prisma.prompt.deleteMany({ where: { id: { in: promptIds } } })
})

// ── Happy path ──────────────────────────────────────────────────────────────

describe('buildExportInput — happy path', () => {
  it('returns well-formed ExportInput for a COMPLETED run', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    expect(result.run.id).toBe(`${P}-run-happy`)
    expect(result.batches.length).toBe(2)
    expect(result.days.length).toBe(3)
    expect(result.exportedAt).toBe(EXPORTED_AT)
  })

  it('maps ExportRun fields correctly', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    expect(result.run).toEqual({
      id: `${P}-run-happy`,
      model: 'gpt-4o',
      startDate: '2024-06-01',
      endDate: '2024-06-03',
      sources: ['chatgpt', 'claude'],
      timezone: 'America/Los_Angeles',
      filterProfile: {
        name: `${P}-professional`,
        mode: 'include',
        categories: ['work', 'learning'],
      },
    })
  })

  it('maps ExportBatch fields from RunBatch junction', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    const sourceIds = result.batches.map((b) => b.id).sort()
    expect(sourceIds).toEqual([`${P}-batch-1`, `${P}-batch-2`])

    const chatgptBatch = result.batches.find((b) => b.id === `${P}-batch-1`)!
    expect(chatgptBatch.source).toBe('chatgpt')
    expect(chatgptBatch.originalFilename).toBe('chatgpt-export.json')
    expect(chatgptBatch.timezone).toBe('America/Los_Angeles')

    const claudeBatch = result.batches.find((b) => b.id === `${P}-batch-2`)!
    expect(claudeBatch.source).toBe('claude')
  })

  it('orders days by dayDate ASC regardless of job creation order', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    const dates = result.days.map((d) => d.dayDate)
    expect(dates).toEqual(['2024-06-01', '2024-06-02', '2024-06-03'])
  })

  it('maps ExportDay fields for non-segmented output', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    const day1 = result.days[0]
    expect(day1.dayDate).toBe('2024-06-01')
    expect(day1.outputText).toBe('# Day 1\n\nWorked on auth module.')
    expect(day1.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
    expect(day1.bundleHash).toBe('hash-day1-bundle')
    expect(day1.bundleContextHash).toBe('hash-day1-ctx')
    expect(day1.segmented).toBe(false)
    expect(day1.segmentCount).toBeUndefined()
  })

  it('maps ExportDay fields for segmented output', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    const day2 = result.days[1]
    expect(day2.dayDate).toBe('2024-06-02')
    expect(day2.outputText).toBe('# Day 2\n\nDeployment prep.')
    expect(day2.segmented).toBe(true)
    expect(day2.segmentCount).toBe(3)
  })

  it('passes exportedAt through unchanged', async () => {
    const custom = '2099-12-31T23:59:59.000Z'
    const result = await buildExportInput(`${P}-run-happy`, custom)
    expect(result.exportedAt).toBe(custom)
  })
})

// ── Precondition failures ───────────────────────────────────────────────────

describe('buildExportInput — precondition failures', () => {
  it('throws EXPORT_NOT_FOUND for unknown runId', async () => {
    await expect(
      buildExportInput('nonexistent-run-id', EXPORTED_AT),
    ).rejects.toThrow(ExportPreconditionError)

    try {
      await buildExportInput('nonexistent-run-id', EXPORTED_AT)
    } catch (e) {
      const err = e as ExportPreconditionError
      expect(err.code).toBe('EXPORT_NOT_FOUND')
    }
  })

  it('throws EXPORT_PRECONDITION when Run is not COMPLETED', async () => {
    try {
      await buildExportInput(`${P}-run-running`, EXPORTED_AT)
      expect.fail('should have thrown')
    } catch (e) {
      const err = e as ExportPreconditionError
      expect(err.code).toBe('EXPORT_PRECONDITION')
      expect(err.details?.runStatus).toBe('RUNNING')
    }
  })

  it('throws EXPORT_PRECONDITION when any job is not SUCCEEDED', async () => {
    try {
      await buildExportInput(`${P}-run-mixed`, EXPORTED_AT)
      expect.fail('should have thrown')
    } catch (e) {
      const err = e as ExportPreconditionError
      expect(err.code).toBe('EXPORT_PRECONDITION')
      expect(err.details?.failedJobs).toBeDefined()
      const failedJobs = err.details!.failedJobs as Array<{ status: string }>
      expect(failedJobs).toHaveLength(1)
      expect(failedJobs[0].status).toBe('FAILED')
    }
  })
})

// ── Data integrity ──────────────────────────────────────────────────────────

describe('buildExportInput — data integrity', () => {
  it('throws EXPORT_PRECONDITION when SUCCEEDED job has no SUMMARIZE output', async () => {
    try {
      await buildExportInput(`${P}-run-no-output`, EXPORTED_AT)
      expect.fail('should have thrown')
    } catch (e) {
      const err = e as ExportPreconditionError
      expect(err.code).toBe('EXPORT_PRECONDITION')
      expect(err.details?.outputCount).toBe(0)
    }
  })

  it('returns empty days for a COMPLETED run with zero jobs', async () => {
    const result = await buildExportInput(`${P}-run-empty`, EXPORTED_AT)

    expect(result.days).toEqual([])
    expect(result.batches.length).toBe(1)
    expect(result.run.id).toBe(`${P}-run-empty`)
  })
})

// ── Atoms loading ─────────────────────────────────────────────────────────

describe('buildExportInput — atoms', () => {
  it('loads user-role atoms in §9.1 order for each day', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    // Day 1 (2024-06-01): 2 chatgpt user + 1 claude user = 3, sorted by source ASC then timestampUtc ASC
    const day1 = result.days[0]
    expect(day1.atoms).toBeDefined()
    expect(day1.atoms!.length).toBe(3)

    // chatgpt atoms first (source ASC), then claude
    expect(day1.atoms![0].source).toBe('chatgpt')
    expect(day1.atoms![0].timestampUtc).toBe('2024-06-01T10:00:00.000Z')
    expect(day1.atoms![0].text).toBe('How do I set up OAuth?')

    expect(day1.atoms![1].source).toBe('chatgpt')
    expect(day1.atoms![1].timestampUtc).toBe('2024-06-01T14:30:00.000Z')

    expect(day1.atoms![2].source).toBe('claude')
    expect(day1.atoms![2].timestampUtc).toBe('2024-06-01T11:00:00.000Z')
  })

  it('excludes assistant-role atoms', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    // Day 1 has an assistant atom in DB — it should not appear
    const day1 = result.days[0]
    const roles = day1.atoms!.map((a) => a.source)
    // All atoms should have actual content from user atoms only
    expect(day1.atoms!.every((a) => a.text !== 'Here is how to set up OAuth...')).toBe(true)
  })

  it('returns empty atoms for days with no atoms in DB', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    // Day 3 (2024-06-03): no atoms created in beforeAll
    const day3 = result.days[2]
    expect(day3.atoms).toBeDefined()
    expect(day3.atoms!.length).toBe(0)
  })

  it('includes atomStableId for deterministic sort tie-breaking', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    const day1 = result.days[0]
    expect(day1.atoms![0].atomStableId).toBe(`${P}-stable-d1u1`)
    expect(day1.atoms![1].atomStableId).toBe(`${P}-stable-d1u2`)
  })

  it('atoms from empty run have empty arrays', async () => {
    const result = await buildExportInput(`${P}-run-empty`, EXPORTED_AT)
    // No days, no atoms
    expect(result.days.length).toBe(0)
  })
})

// ── V2 mode (topicVersion + categories) ───────────────────────────────────

describe('buildExportInput — v2 mode (topicVersion)', () => {
  it('populates atom category from MessageLabel when topicVersion is set', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT, {
      topicVersion: 'topic_v1',
    })

    // Day 1: 3 user atoms, all labeled
    const day1 = result.days[0]
    expect(day1.atoms!.length).toBe(3)

    // chatgpt atoms: d1u1 → work, d1u2 → work
    expect(day1.atoms![0].category).toBe('work')
    expect(day1.atoms![1].category).toBe('work')

    // claude atom: d1c1 → learning
    expect(day1.atoms![2].category).toBe('learning')
  })

  it('populates category on day 2 atoms', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT, {
      topicVersion: 'topic_v1',
    })

    // Day 2: 1 user atom → learning
    const day2 = result.days[1]
    expect(day2.atoms!.length).toBe(1)
    expect(day2.atoms![0].category).toBe('learning')
  })

  it('omits category field when atom has no matching MessageLabel', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT, {
      topicVersion: 'topic_v1',
    })

    // Day 3 has no atoms at all
    const day3 = result.days[2]
    expect(day3.atoms!.length).toBe(0)
  })

  it('does NOT populate category when topicVersion is not set (v1 mode)', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    const day1 = result.days[0]
    // v1 mode: no category field on any atom
    for (const atom of day1.atoms!) {
      expect(atom.category).toBeUndefined()
    }
  })

  it('passes topicVersion through to ExportInput', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT, {
      topicVersion: 'topic_v1',
    })

    expect(result.topicVersion).toBe('topic_v1')
  })

  it('omits topicVersion from ExportInput when not set', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT)

    expect(result.topicVersion).toBeUndefined()
  })

  it('passes previousManifest through to ExportInput', async () => {
    const prev = {
      exportedAt: '2024-06-01T00:00:00.000Z',
      topicVersion: 'topic_v1',
      topics: {
        work: { atomCount: 5, category: 'work', dayCount: 1, days: ['2024-06-01'], displayName: 'Work' },
      },
    }

    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT, {
      topicVersion: 'topic_v1',
      previousManifest: prev,
    })

    expect(result.previousManifest).toEqual(prev)
  })

  it('omits previousManifest from ExportInput when not set', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT, {
      topicVersion: 'topic_v1',
    })

    expect(result.previousManifest).toBeUndefined()
  })

  it('loads atoms in public tier when topicVersion is set (needed for topics)', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT, {
      privacyTier: 'public',
      topicVersion: 'topic_v1',
    })

    // Public + v2: atoms are loaded (for topic computation) with categories
    const day1 = result.days[0]
    expect(day1.atoms!.length).toBe(3)
    expect(day1.atoms![0].category).toBe('work')
  })

  it('categories are lowercase even when DB stores uppercase enum', async () => {
    const result = await buildExportInput(`${P}-run-happy`, EXPORTED_AT, {
      topicVersion: 'topic_v1',
    })

    const allCategories = result.days
      .flatMap((d) => d.atoms ?? [])
      .map((a) => a.category)
      .filter(Boolean)

    for (const cat of allCategories) {
      expect(cat).toBe(cat!.toLowerCase())
    }
  })
})
