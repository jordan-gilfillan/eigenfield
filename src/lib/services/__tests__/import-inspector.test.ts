import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { getImportBatchDays, getImportBatchDayAtoms } from '@/lib/services/import'

/**
 * Integration tests for the import inspector service functions (PR-6.3).
 *
 * These tests require a running database.
 * They create test data, exercise the inspector queries, and clean up.
 */

// Track IDs for cleanup
let importBatchId: string
let promptId: string
let promptVersionId: string
const atomIds: string[] = []
const labelIds: string[] = []

beforeAll(async () => {
  // Create prompt + version for labels
  const prompt = await prisma.prompt.create({
    data: {
      id: 'inspect-test-prompt',
      stage: 'CLASSIFY',
      name: 'inspect-test-classify',
    },
  })
  promptId = prompt.id

  const pv = await prisma.promptVersion.create({
    data: {
      id: 'inspect-test-pv',
      promptId: prompt.id,
      versionLabel: 'v1',
      templateText: 'Classify: {{text}}',
      isActive: true,
    },
  })
  promptVersionId = pv.id

  // Create ImportBatch
  const batch = await prisma.importBatch.create({
    data: {
      id: 'inspect-test-batch',
      source: 'CHATGPT',
      originalFilename: 'inspect-test.json',
      fileSizeBytes: 2000,
      timezone: 'UTC',
      statsJson: {
        message_count: 6,
        day_count: 2,
        coverage_start: '2024-03-10',
        coverage_end: '2024-03-11',
        per_source_counts: { chatgpt: 4, claude: 2 },
      },
    },
  })
  importBatchId = batch.id

  // Create atoms across 2 days, 2 sources
  // Day 1: 2024-03-10, chatgpt (2 atoms) + claude (1 atom)
  // Day 2: 2024-03-11, chatgpt (2 atoms) + claude (1 atom)
  const atoms = [
    // Day 1 - chatgpt user (earlier)
    {
      id: 'inspect-atom-1',
      atomStableId: 'inspect-stable-aaa',
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-03-10T09:00:00.000Z'),
      dayDate: new Date('2024-03-10'),
      role: 'USER' as const,
      text: 'Hello, how do I sort arrays?',
      textHash: 'inspect-hash-1',
    },
    // Day 1 - chatgpt assistant (same timestamp as user - test role ordering)
    {
      id: 'inspect-atom-2',
      atomStableId: 'inspect-stable-bbb',
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-03-10T09:00:00.000Z'),
      dayDate: new Date('2024-03-10'),
      role: 'ASSISTANT' as const,
      text: 'You can use Array.sort() in JavaScript.',
      textHash: 'inspect-hash-2',
    },
    // Day 1 - claude user (later)
    {
      id: 'inspect-atom-3',
      atomStableId: 'inspect-stable-ccc',
      importBatchId,
      source: 'CLAUDE' as const,
      timestampUtc: new Date('2024-03-10T14:00:00.000Z'),
      dayDate: new Date('2024-03-10'),
      role: 'USER' as const,
      text: 'Explain merge sort algorithm.',
      textHash: 'inspect-hash-3',
    },
    // Day 2 - chatgpt user
    {
      id: 'inspect-atom-4',
      atomStableId: 'inspect-stable-ddd',
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-03-11T10:00:00.000Z'),
      dayDate: new Date('2024-03-11'),
      role: 'USER' as const,
      text: 'What is binary search?',
      textHash: 'inspect-hash-4',
    },
    // Day 2 - chatgpt assistant
    {
      id: 'inspect-atom-5',
      atomStableId: 'inspect-stable-eee',
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-03-11T10:01:00.000Z'),
      dayDate: new Date('2024-03-11'),
      role: 'ASSISTANT' as const,
      text: 'Binary search is an efficient algorithm for finding items in sorted arrays.',
      textHash: 'inspect-hash-5',
    },
    // Day 2 - claude user
    {
      id: 'inspect-atom-6',
      atomStableId: 'inspect-stable-fff',
      importBatchId,
      source: 'CLAUDE' as const,
      timestampUtc: new Date('2024-03-11T15:00:00.000Z'),
      dayDate: new Date('2024-03-11'),
      role: 'USER' as const,
      text: 'How does quicksort work?',
      textHash: 'inspect-hash-6',
    },
  ]

  for (const atom of atoms) {
    await prisma.messageAtom.create({ data: atom })
    atomIds.push(atom.id)
  }

  // Add labels for some atoms
  const label1 = await prisma.messageLabel.create({
    data: {
      id: 'inspect-label-1',
      messageAtomId: 'inspect-atom-1',
      category: 'LEARNING',
      confidence: 0.8,
      model: 'stub_v1',
      promptVersionId,
    },
  })
  labelIds.push(label1.id)

  const label2 = await prisma.messageLabel.create({
    data: {
      id: 'inspect-label-2',
      messageAtomId: 'inspect-atom-2',
      category: 'LEARNING',
      confidence: 0.75,
      model: 'stub_v1',
      promptVersionId,
    },
  })
  labelIds.push(label2.id)
})

afterAll(async () => {
  // Clean up in reverse dependency order
  await prisma.messageLabel.deleteMany({ where: { id: { in: labelIds } } })
  await prisma.messageAtom.deleteMany({ where: { id: { in: atomIds } } })
  await prisma.importBatch.deleteMany({ where: { id: importBatchId } })
  await prisma.promptVersion.deleteMany({ where: { id: promptVersionId } })
  await prisma.prompt.deleteMany({ where: { id: promptId } })
})

describe('Import Inspector - getImportBatchDays', () => {
  it('returns days in ASC order', async () => {
    const days = await getImportBatchDays(importBatchId)

    expect(days).toHaveLength(2)
    expect(days[0].dayDate).toBe('2024-03-10')
    expect(days[1].dayDate).toBe('2024-03-11')
  })

  it('returns correct atom counts per day', async () => {
    const days = await getImportBatchDays(importBatchId)

    expect(days[0].atomCount).toBe(3) // 2 chatgpt + 1 claude
    expect(days[1].atomCount).toBe(3) // 2 chatgpt + 1 claude
  })

  it('returns sources per day sorted alphabetically', async () => {
    const days = await getImportBatchDays(importBatchId)

    // Both days have chatgpt + claude
    expect(days[0].sources).toEqual(['chatgpt', 'claude'])
    expect(days[1].sources).toEqual(['chatgpt', 'claude'])
  })

  it('returns empty array for nonexistent batch', async () => {
    const days = await getImportBatchDays('nonexistent-batch-id')
    expect(days).toEqual([])
  })
})

describe('Import Inspector - getImportBatchDayAtoms', () => {
  it('returns atoms in deterministic order: timestampUtc ASC, role ASC (user before assistant), atomStableId ASC', async () => {
    const atoms = await getImportBatchDayAtoms({
      importBatchId,
      dayDate: '2024-03-10',
    })

    expect(atoms).toHaveLength(3)

    // Atom 1 and 2 have same timestamp (09:00). User should come before assistant.
    expect(atoms[0].role).toBe('user')
    expect(atoms[0].atomStableId).toBe('inspect-stable-aaa')

    expect(atoms[1].role).toBe('assistant')
    expect(atoms[1].atomStableId).toBe('inspect-stable-bbb')

    // Atom 3 has later timestamp (14:00)
    expect(atoms[2].atomStableId).toBe('inspect-stable-ccc')
    expect(atoms[2].source).toBe('claude')
  })

  it('returns atoms for day 2 in order', async () => {
    const atoms = await getImportBatchDayAtoms({
      importBatchId,
      dayDate: '2024-03-11',
    })

    expect(atoms).toHaveLength(3)
    expect(atoms[0].atomStableId).toBe('inspect-stable-ddd')
    expect(atoms[1].atomStableId).toBe('inspect-stable-eee')
    expect(atoms[2].atomStableId).toBe('inspect-stable-fff')
  })

  it('filters by source', async () => {
    const atoms = await getImportBatchDayAtoms({
      importBatchId,
      dayDate: '2024-03-10',
      source: 'claude',
    })

    expect(atoms).toHaveLength(1)
    expect(atoms[0].source).toBe('claude')
    expect(atoms[0].atomStableId).toBe('inspect-stable-ccc')
  })

  it('returns empty array for chatgpt filter on claude-only day segment', async () => {
    // Day 1 has both sources; filter to claude should only get 1
    const atoms = await getImportBatchDayAtoms({
      importBatchId,
      dayDate: '2024-03-10',
      source: 'chatgpt',
    })

    expect(atoms).toHaveLength(2)
    atoms.forEach((a) => expect(a.source).toBe('chatgpt'))
  })

  it('returns empty for nonexistent day', async () => {
    const atoms = await getImportBatchDayAtoms({
      importBatchId,
      dayDate: '2024-12-25',
    })

    expect(atoms).toHaveLength(0)
  })

  it('includes category and confidence from labels', async () => {
    const atoms = await getImportBatchDayAtoms({
      importBatchId,
      dayDate: '2024-03-10',
    })

    // Atoms 1 and 2 have labels
    const atom1 = atoms.find((a) => a.atomStableId === 'inspect-stable-aaa')!
    expect(atom1.category).toBe('learning')
    expect(atom1.confidence).toBe(0.8)

    const atom2 = atoms.find((a) => a.atomStableId === 'inspect-stable-bbb')!
    expect(atom2.category).toBe('learning')
    expect(atom2.confidence).toBe(0.75)

    // Atom 3 has no label
    const atom3 = atoms.find((a) => a.atomStableId === 'inspect-stable-ccc')!
    expect(atom3.category).toBeNull()
    expect(atom3.confidence).toBeNull()
  })

  it('returns correct field types for atom views', async () => {
    const atoms = await getImportBatchDayAtoms({
      importBatchId,
      dayDate: '2024-03-10',
    })

    expect(atoms.length).toBeGreaterThan(0)
    const atom = atoms[0]

    expect(typeof atom.atomStableId).toBe('string')
    expect(typeof atom.source).toBe('string')
    expect(typeof atom.timestampUtc).toBe('string')
    expect(typeof atom.role).toBe('string')
    expect(typeof atom.text).toBe('string')

    // Source and role should be lowercase (API convention)
    expect(atom.source).toBe('chatgpt')
    expect(['user', 'assistant']).toContain(atom.role)

    // timestampUtc should be ISO format
    expect(atom.timestampUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
