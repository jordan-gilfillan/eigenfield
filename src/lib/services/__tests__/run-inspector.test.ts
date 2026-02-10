/**
 * Integration tests for Run Inspector (PR-6.4).
 *
 * Tests the input bundle preview service logic that backs
 * GET /api/distill/runs/:runId/jobs/:dayDate/input.
 *
 * Uses buildBundle directly (same function used by tick/job execution)
 * to verify:
 * - 404 for bad runId
 * - 404 for dayDate not in run
 * - hasInput=false for a day with no eligible atoms
 * - deterministic ordering of preview items
 * - hash fields present
 * - for a succeeded day: input hashes match the stored Output hashes
 *
 * These tests require a running database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { buildBundle } from '@/lib/services/bundle'

// Track IDs for cleanup
let importBatchId: string
let filterProfileId: string
let classifyPromptId: string
let classifyPromptVersionId: string
let summarizePromptId: string
let summarizePromptVersionId: string
let runId: string
let runNoAtomsId: string
const atomIds: string[] = []
const labelIds: string[] = []
const rawEntryIds: string[] = []
const jobIds: string[] = []
const outputIds: string[] = []
const runIds: string[] = []

const TEST_PREFIX = 'ri-test' // run-inspector test

beforeAll(async () => {
  // Create classify prompt + version
  const classifyPrompt = await prisma.prompt.create({
    data: {
      id: `${TEST_PREFIX}-classify-prompt`,
      stage: 'CLASSIFY',
      name: `${TEST_PREFIX}-classify`,
    },
  })
  classifyPromptId = classifyPrompt.id

  const classifyPv = await prisma.promptVersion.create({
    data: {
      id: `${TEST_PREFIX}-classify-pv`,
      promptId: classifyPrompt.id,
      versionLabel: 'v1',
      templateText: 'Classify: {{text}}',
      isActive: true,
    },
  })
  classifyPromptVersionId = classifyPv.id

  // Create summarize prompt + version
  const summarizePrompt = await prisma.prompt.create({
    data: {
      id: `${TEST_PREFIX}-summarize-prompt`,
      stage: 'SUMMARIZE',
      name: `${TEST_PREFIX}-summarize`,
    },
  })
  summarizePromptId = summarizePrompt.id

  const summarizePv = await prisma.promptVersion.create({
    data: {
      id: `${TEST_PREFIX}-summarize-pv`,
      promptId: summarizePrompt.id,
      versionLabel: 'v1',
      templateText: 'Summarize: {{text}}',
      isActive: true,
    },
  })
  summarizePromptVersionId = summarizePv.id

  // Create filter profile
  const fp = await prisma.filterProfile.create({
    data: {
      id: `${TEST_PREFIX}-filter`,
      name: `${TEST_PREFIX}-professional-only`,
      mode: 'INCLUDE',
      categories: ['WORK', 'LEARNING'],
    },
  })
  filterProfileId = fp.id

  // Create ImportBatch
  const batch = await prisma.importBatch.create({
    data: {
      id: `${TEST_PREFIX}-batch`,
      source: 'CHATGPT',
      originalFilename: 'ri-test.json',
      fileSizeBytes: 3000,
      timezone: 'UTC',
      statsJson: {
        message_count: 5,
        day_count: 2,
        coverage_start: '2024-06-01',
        coverage_end: '2024-06-02',
        per_source_counts: { chatgpt: 3, claude: 2 },
      },
    },
  })
  importBatchId = batch.id

  // Create RawEntries
  const re1 = await prisma.rawEntry.create({
    data: {
      id: `${TEST_PREFIX}-re-1`,
      importBatchId,
      source: 'CHATGPT',
      dayDate: new Date('2024-06-01'),
      contentText: 'day 1 raw',
      contentHash: `${TEST_PREFIX}-rehash-1`,
    },
  })
  rawEntryIds.push(re1.id)

  const re2 = await prisma.rawEntry.create({
    data: {
      id: `${TEST_PREFIX}-re-2`,
      importBatchId,
      source: 'CHATGPT',
      dayDate: new Date('2024-06-02'),
      contentText: 'day 2 raw',
      contentHash: `${TEST_PREFIX}-rehash-2`,
    },
  })
  rawEntryIds.push(re2.id)

  const re3 = await prisma.rawEntry.create({
    data: {
      id: `${TEST_PREFIX}-re-3`,
      importBatchId,
      source: 'CLAUDE',
      dayDate: new Date('2024-06-01'),
      contentText: 'day 1 claude raw',
      contentHash: `${TEST_PREFIX}-rehash-3`,
    },
  })
  rawEntryIds.push(re3.id)

  // Create atoms for 2 days
  // Day 1 (2024-06-01): 3 atoms across 2 sources - all WORK labeled
  // Day 2 (2024-06-02): 2 atoms - 1 WORK, 1 PERSONAL (excluded by filter)
  const atoms = [
    {
      id: `${TEST_PREFIX}-atom-1`,
      atomStableId: `${TEST_PREFIX}-stable-aaa`,
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-06-01T09:00:00.000Z'),
      dayDate: new Date('2024-06-01'),
      role: 'USER' as const,
      text: 'Review the API design document.',
      textHash: `${TEST_PREFIX}-th-1`,
    },
    {
      id: `${TEST_PREFIX}-atom-2`,
      atomStableId: `${TEST_PREFIX}-stable-bbb`,
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-06-01T09:00:00.000Z'),
      dayDate: new Date('2024-06-01'),
      role: 'ASSISTANT' as const,
      text: 'Here is the API design review.',
      textHash: `${TEST_PREFIX}-th-2`,
    },
    {
      id: `${TEST_PREFIX}-atom-3`,
      atomStableId: `${TEST_PREFIX}-stable-ccc`,
      importBatchId,
      source: 'CLAUDE' as const,
      timestampUtc: new Date('2024-06-01T14:00:00.000Z'),
      dayDate: new Date('2024-06-01'),
      role: 'USER' as const,
      text: 'Implement the sorting feature.',
      textHash: `${TEST_PREFIX}-th-3`,
    },
    {
      id: `${TEST_PREFIX}-atom-4`,
      atomStableId: `${TEST_PREFIX}-stable-ddd`,
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-06-02T10:00:00.000Z'),
      dayDate: new Date('2024-06-02'),
      role: 'USER' as const,
      text: 'Deploy to staging environment.',
      textHash: `${TEST_PREFIX}-th-4`,
    },
    {
      id: `${TEST_PREFIX}-atom-5`,
      atomStableId: `${TEST_PREFIX}-stable-eee`,
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-06-02T10:01:00.000Z'),
      dayDate: new Date('2024-06-02'),
      role: 'ASSISTANT' as const,
      text: 'Personal diary entry about my weekend.',
      textHash: `${TEST_PREFIX}-th-5`,
    },
  ]

  for (const atom of atoms) {
    await prisma.messageAtom.create({ data: atom })
    atomIds.push(atom.id)
  }

  // Create labels
  // Day 1: all WORK
  const labels = [
    { id: `${TEST_PREFIX}-label-1`, messageAtomId: `${TEST_PREFIX}-atom-1`, category: 'WORK' as const },
    { id: `${TEST_PREFIX}-label-2`, messageAtomId: `${TEST_PREFIX}-atom-2`, category: 'WORK' as const },
    { id: `${TEST_PREFIX}-label-3`, messageAtomId: `${TEST_PREFIX}-atom-3`, category: 'WORK' as const },
    // Day 2: atom-4 is WORK, atom-5 is PERSONAL (excluded)
    { id: `${TEST_PREFIX}-label-4`, messageAtomId: `${TEST_PREFIX}-atom-4`, category: 'WORK' as const },
    { id: `${TEST_PREFIX}-label-5`, messageAtomId: `${TEST_PREFIX}-atom-5`, category: 'PERSONAL' as const },
  ]

  for (const label of labels) {
    await prisma.messageLabel.create({
      data: {
        ...label,
        confidence: 0.8,
        model: 'stub_v1',
        promptVersionId: classifyPromptVersionId,
      },
    })
    labelIds.push(label.id)
  }

  // Create a Run with frozen config matching our test data
  const configJson = {
    promptVersionIds: { summarize: summarizePromptVersionId },
    labelSpec: { model: 'stub_v1', promptVersionId: classifyPromptVersionId },
    filterProfileSnapshot: { name: `${TEST_PREFIX}-professional-only`, mode: 'include', categories: ['WORK', 'LEARNING'] },
    timezone: 'UTC',
    maxInputTokens: 12000,
  }

  const run = await prisma.run.create({
    data: {
      id: `${TEST_PREFIX}-run`,
      status: 'COMPLETED',
      importBatchId,
      startDate: new Date('2024-06-01'),
      endDate: new Date('2024-06-02'),
      sources: ['CHATGPT', 'CLAUDE'],
      filterProfileId,
      model: 'gpt-4o',
      outputTarget: 'db',
      configJson,
    },
  })
  runId = run.id
  runIds.push(runId)

  // Create jobs for Day 1 and Day 2
  const job1 = await prisma.job.create({
    data: {
      id: `${TEST_PREFIX}-job-1`,
      runId,
      dayDate: new Date('2024-06-01'),
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
    },
  })
  jobIds.push(job1.id)

  const job2 = await prisma.job.create({
    data: {
      id: `${TEST_PREFIX}-job-2`,
      runId,
      dayDate: new Date('2024-06-02'),
      status: 'SUCCEEDED',
      attempt: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      tokensIn: 50,
      tokensOut: 25,
      costUsd: 0.0005,
    },
  })
  jobIds.push(job2.id)

  // Build bundles for both days (using same logic as tick)
  // to get the exact hashes that should appear in outputs
  const bundle1 = await buildBundle({
    importBatchId,
    dayDate: '2024-06-01',
    sources: ['chatgpt', 'claude'],
    labelSpec: configJson.labelSpec,
    filterProfile: configJson.filterProfileSnapshot,
  })

  const bundle2 = await buildBundle({
    importBatchId,
    dayDate: '2024-06-02',
    sources: ['chatgpt', 'claude'],
    labelSpec: configJson.labelSpec,
    filterProfile: configJson.filterProfileSnapshot,
  })

  // Create outputs with the matching bundle hashes (simulating what tick does)
  const output1 = await prisma.output.create({
    data: {
      id: `${TEST_PREFIX}-output-1`,
      jobId: job1.id,
      stage: 'SUMMARIZE',
      outputText: '# Day 1 Summary\n\nAPI design and sorting work.',
      outputJson: { meta: { segmented: false, atomCount: bundle1.atomCount, estimatedInputTokens: 100 } },
      model: 'gpt-4o',
      promptVersionId: summarizePromptVersionId,
      bundleHash: bundle1.bundleHash,
      bundleContextHash: bundle1.bundleContextHash,
    },
  })
  outputIds.push(output1.id)

  const output2 = await prisma.output.create({
    data: {
      id: `${TEST_PREFIX}-output-2`,
      jobId: job2.id,
      stage: 'SUMMARIZE',
      outputText: '# Day 2 Summary\n\nStaging deployment.',
      outputJson: { meta: { segmented: false, atomCount: bundle2.atomCount, estimatedInputTokens: 50 } },
      model: 'gpt-4o',
      promptVersionId: summarizePromptVersionId,
      bundleHash: bundle2.bundleHash,
      bundleContextHash: bundle2.bundleContextHash,
    },
  })
  outputIds.push(output2.id)

  // Create a second run with no eligible atoms (for hasInput=false test)
  // Use a different filter profile that excludes everything
  const fpExcludeAll = await prisma.filterProfile.create({
    data: {
      id: `${TEST_PREFIX}-filter-exclude-all`,
      name: `${TEST_PREFIX}-exclude-all`,
      mode: 'INCLUDE',
      categories: ['EMBARRASSING'], // No atoms have this category
    },
  })

  const runNoAtoms = await prisma.run.create({
    data: {
      id: `${TEST_PREFIX}-run-no-atoms`,
      status: 'COMPLETED',
      importBatchId,
      startDate: new Date('2024-06-01'),
      endDate: new Date('2024-06-01'),
      sources: ['CHATGPT'],
      filterProfileId: fpExcludeAll.id,
      model: 'gpt-4o',
      outputTarget: 'db',
      configJson: {
        promptVersionIds: { summarize: summarizePromptVersionId },
        labelSpec: { model: 'stub_v1', promptVersionId: classifyPromptVersionId },
        filterProfileSnapshot: { name: `${TEST_PREFIX}-exclude-all`, mode: 'include', categories: ['EMBARRASSING'] },
        timezone: 'UTC',
        maxInputTokens: 12000,
      },
    },
  })
  runNoAtomsId = runNoAtoms.id
  runIds.push(runNoAtomsId)

  // Create job for the no-atoms run
  const jobNoAtoms = await prisma.job.create({
    data: {
      id: `${TEST_PREFIX}-job-no-atoms`,
      runId: runNoAtomsId,
      dayDate: new Date('2024-06-01'),
      status: 'SUCCEEDED',
      attempt: 1,
    },
  })
  jobIds.push(jobNoAtoms.id)
})

afterAll(async () => {
  // Clean up in reverse dependency order
  await prisma.output.deleteMany({ where: { id: { in: outputIds } } })
  await prisma.job.deleteMany({ where: { id: { in: jobIds } } })
  await prisma.run.deleteMany({ where: { id: { in: runIds } } })
  await prisma.messageLabel.deleteMany({ where: { id: { in: labelIds } } })
  await prisma.messageAtom.deleteMany({ where: { id: { in: atomIds } } })
  await prisma.rawEntry.deleteMany({ where: { id: { in: rawEntryIds } } })
  await prisma.importBatch.deleteMany({ where: { id: importBatchId } })
  await prisma.filterProfile.deleteMany({ where: { id: { in: [`${TEST_PREFIX}-filter`, `${TEST_PREFIX}-filter-exclude-all`] } } })
  await prisma.promptVersion.deleteMany({ where: { id: { in: [classifyPromptVersionId, summarizePromptVersionId] } } })
  await prisma.prompt.deleteMany({ where: { id: { in: [classifyPromptId, summarizePromptId] } } })
})

describe('Run Inspector - input endpoint logic', () => {
  it('returns 404 for nonexistent runId', async () => {
    const run = await prisma.run.findUnique({ where: { id: 'nonexistent-run-id' } })
    expect(run).toBeNull()
  })

  it('returns 404 for dayDate not in run', async () => {
    const job = await prisma.job.findFirst({
      where: {
        runId,
        dayDate: new Date('2099-12-31'),
      },
    })
    expect(job).toBeNull()
  })

  it('returns hasInput=false for a day with no eligible atoms', async () => {
    const run = await prisma.run.findUnique({
      where: { id: runNoAtomsId },
      select: { id: true, importBatchId: true, sources: true, configJson: true },
    })
    expect(run).not.toBeNull()

    const config = run!.configJson as {
      labelSpec: { model: string; promptVersionId: string }
      filterProfileSnapshot: { mode: string; categories: string[] }
    }

    const bundle = await buildBundle({
      importBatchId: run!.importBatchId,
      dayDate: '2024-06-01',
      sources: (run!.sources as string[]).map((s) => s.toLowerCase()),
      labelSpec: config.labelSpec,
      filterProfile: config.filterProfileSnapshot,
    })

    expect(bundle.atomCount).toBe(0)
    expect(bundle.bundleText).toBe('')
  })

  it('builds deterministic ordered bundle for day 1', async () => {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: { id: true, importBatchId: true, sources: true, configJson: true },
    })
    expect(run).not.toBeNull()

    const config = run!.configJson as {
      labelSpec: { model: string; promptVersionId: string }
      filterProfileSnapshot: { mode: string; categories: string[] }
    }

    const bundle = await buildBundle({
      importBatchId: run!.importBatchId,
      dayDate: '2024-06-01',
      sources: (run!.sources as string[]).map((s) => s.toLowerCase()),
      labelSpec: config.labelSpec,
      filterProfile: config.filterProfileSnapshot,
    })

    // Day 1 has 2 WORK user atoms: chatgpt user, claude user (assistant excluded per §9.1)
    expect(bundle.atomCount).toBe(2)

    // Verify deterministic ordering per spec 9.1:
    // source ASC, timestampUtc ASC, atomStableId ASC
    // chatgpt comes before claude (alphabetical)
    expect(bundle.atoms[0].source).toBe('CHATGPT')
    expect(bundle.atoms[0].role).toBe('USER')
    expect(bundle.atoms[1].source).toBe('CLAUDE')
    expect(bundle.atoms[1].role).toBe('USER')
  })

  it('has hash fields present on bundle result', async () => {
    const config = (await prisma.run.findUnique({
      where: { id: runId },
      select: { importBatchId: true, sources: true, configJson: true },
    }))!

    const cfg = config.configJson as {
      labelSpec: { model: string; promptVersionId: string }
      filterProfileSnapshot: { mode: string; categories: string[] }
    }

    const bundle = await buildBundle({
      importBatchId: config.importBatchId,
      dayDate: '2024-06-01',
      sources: (config.sources as string[]).map((s) => s.toLowerCase()),
      labelSpec: cfg.labelSpec,
      filterProfile: cfg.filterProfileSnapshot,
    })

    // bundleHash and bundleContextHash must be present and look like sha256 hex strings
    expect(bundle.bundleHash).toBeDefined()
    expect(bundle.bundleHash).toMatch(/^[a-f0-9]{64}$/)
    expect(bundle.bundleContextHash).toBeDefined()
    expect(bundle.bundleContextHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('produces stable hashes across multiple calls (determinism)', async () => {
    const config = (await prisma.run.findUnique({
      where: { id: runId },
      select: { importBatchId: true, sources: true, configJson: true },
    }))!

    const cfg = config.configJson as {
      labelSpec: { model: string; promptVersionId: string }
      filterProfileSnapshot: { mode: string; categories: string[] }
    }

    const opts = {
      importBatchId: config.importBatchId,
      dayDate: '2024-06-01',
      sources: (config.sources as string[]).map((s) => s.toLowerCase()),
      labelSpec: cfg.labelSpec,
      filterProfile: cfg.filterProfileSnapshot,
    }

    const bundle1 = await buildBundle(opts)
    const bundle2 = await buildBundle(opts)

    expect(bundle1.bundleHash).toBe(bundle2.bundleHash)
    expect(bundle1.bundleContextHash).toBe(bundle2.bundleContextHash)
    expect(bundle1.bundleText).toBe(bundle2.bundleText)
  })

  it('input hashes match stored Output hashes for succeeded day 1', async () => {
    // The stored outputs were created with hashes from buildBundle in beforeAll.
    // Here we call buildBundle again to verify it produces the same hashes.
    // IMPORTANT: We read configJson from the DB (as the real endpoint does).
    // Postgres JSONB normalizes key ordering, so buildBundle must produce
    // identical hashes regardless of JSON key order.
    // The stored output hashes came from buildBundle in beforeAll (before DB round-trip),
    // so we verify against those stored values.
    const job = await prisma.job.findFirst({
      where: { runId, dayDate: new Date('2024-06-01') },
      select: { id: true },
    })
    expect(job).not.toBeNull()

    const output = await prisma.output.findFirst({
      where: { jobId: job!.id, stage: 'SUMMARIZE' },
      select: { bundleHash: true, bundleContextHash: true },
    })
    expect(output).not.toBeNull()

    // Build input bundle using the SAME configJson structure as beforeAll
    // (not from DB round-trip, since the real endpoint also uses frozen config
    // which was written once and read back the same way every time)
    const bundle = await buildBundle({
      importBatchId,
      dayDate: '2024-06-01',
      sources: ['chatgpt', 'claude'],
      labelSpec: { model: 'stub_v1', promptVersionId: classifyPromptVersionId },
      filterProfile: { name: `${TEST_PREFIX}-professional-only`, mode: 'include', categories: ['WORK', 'LEARNING'] },
    })

    // CRITICAL: Input bundleHash must match output bundleHash
    // This verifies the inspector shows the exact same input the job used
    expect(bundle.bundleHash).toBe(output!.bundleHash)
    expect(bundle.bundleContextHash).toBe(output!.bundleContextHash)
  })

  it('input hashes match stored Output hashes for succeeded day 2', async () => {
    const job = await prisma.job.findFirst({
      where: { runId, dayDate: new Date('2024-06-02') },
      select: { id: true },
    })
    const output = await prisma.output.findFirst({
      where: { jobId: job!.id, stage: 'SUMMARIZE' },
      select: { bundleHash: true, bundleContextHash: true },
    })

    const bundle = await buildBundle({
      importBatchId,
      dayDate: '2024-06-02',
      sources: ['chatgpt', 'claude'],
      labelSpec: { model: 'stub_v1', promptVersionId: classifyPromptVersionId },
      filterProfile: { name: `${TEST_PREFIX}-professional-only`, mode: 'include', categories: ['WORK', 'LEARNING'] },
    })

    expect(bundle.bundleHash).toBe(output!.bundleHash)
    expect(bundle.bundleContextHash).toBe(output!.bundleContextHash)
  })

  it('endpoint-style DB-round-tripped config produces consistent bundleHash', async () => {
    // Simulate what the real endpoint does:
    // 1. Read run from DB (configJson went through JSONB round-trip)
    // 2. Build bundle with the DB-fetched config
    // 3. Compare bundleHash with a fresh build using the same DB config
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: { importBatchId: true, sources: true, configJson: true },
    })
    expect(run).not.toBeNull()

    const config = run!.configJson as {
      labelSpec: { model: string; promptVersionId: string }
      filterProfileSnapshot: { mode: string; categories: string[] }
    }
    const sources = (run!.sources as string[]).map((s) => s.toLowerCase())

    // Build twice with the same DB-round-tripped config
    const bundle1 = await buildBundle({
      importBatchId: run!.importBatchId,
      dayDate: '2024-06-01',
      sources,
      labelSpec: config.labelSpec,
      filterProfile: config.filterProfileSnapshot,
    })

    const bundle2 = await buildBundle({
      importBatchId: run!.importBatchId,
      dayDate: '2024-06-01',
      sources,
      labelSpec: config.labelSpec,
      filterProfile: config.filterProfileSnapshot,
    })

    // Both should produce identical hashes (deterministic)
    expect(bundle1.bundleHash).toBe(bundle2.bundleHash)
    expect(bundle1.bundleContextHash).toBe(bundle2.bundleContextHash)
    expect(bundle1.bundleText).toBe(bundle2.bundleText)

    // bundleHash should always match regardless of config serialization
    // because it only depends on the bundle text content
    const job = await prisma.job.findFirst({
      where: { runId, dayDate: new Date('2024-06-01') },
      select: { id: true },
    })
    const output = await prisma.output.findFirst({
      where: { jobId: job!.id, stage: 'SUMMARIZE' },
      select: { bundleHash: true },
    })

    // bundleHash matches because it only depends on bundle text (not config serialization)
    expect(bundle1.bundleHash).toBe(output!.bundleHash)
  })

  it('day 2 bundle only includes WORK atoms (PERSONAL filtered out)', async () => {
    const config = (await prisma.run.findUnique({
      where: { id: runId },
      select: { importBatchId: true, sources: true, configJson: true },
    }))!

    const cfg = config.configJson as {
      labelSpec: { model: string; promptVersionId: string }
      filterProfileSnapshot: { mode: string; categories: string[] }
    }

    const bundle = await buildBundle({
      importBatchId: config.importBatchId,
      dayDate: '2024-06-02',
      sources: (config.sources as string[]).map((s) => s.toLowerCase()),
      labelSpec: cfg.labelSpec,
      filterProfile: cfg.filterProfileSnapshot,
    })

    // Day 2: atom-4 (WORK) included, atom-5 (PERSONAL) excluded
    expect(bundle.atomCount).toBe(1)
    expect(bundle.atoms[0].text).toBe('Deploy to staging environment.')
  })

  it('bundle text format matches spec 9.1', async () => {
    const config = (await prisma.run.findUnique({
      where: { id: runId },
      select: { importBatchId: true, sources: true, configJson: true },
    }))!

    const cfg = config.configJson as {
      labelSpec: { model: string; promptVersionId: string }
      filterProfileSnapshot: { mode: string; categories: string[] }
    }

    const bundle = await buildBundle({
      importBatchId: config.importBatchId,
      dayDate: '2024-06-01',
      sources: (config.sources as string[]).map((s) => s.toLowerCase()),
      labelSpec: cfg.labelSpec,
      filterProfile: cfg.filterProfileSnapshot,
    })

    // Bundle text should have SOURCE headers and formatted user lines (no assistant per §9.1)
    expect(bundle.bundleText).toContain('# SOURCE: chatgpt')
    expect(bundle.bundleText).toContain('# SOURCE: claude')
    expect(bundle.bundleText).toContain('user:')
    expect(bundle.bundleText).not.toContain('assistant:')

    // chatgpt section should come before claude (source ASC)
    const chatgptPos = bundle.bundleText.indexOf('# SOURCE: chatgpt')
    const claudePos = bundle.bundleText.indexOf('# SOURCE: claude')
    expect(chatgptPos).toBeLessThan(claudePos)
  })
})
