/**
 * Tests for Bundle Service
 *
 * Spec references: 9.1 (Bundle ordering), 5.3 (Bundle hashes)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../db'
import { buildBundle, estimateTokens } from '../bundle'

describe('bundle service', () => {
  let testImportBatchId: string
  let testClassifyPromptVersionId: string
  let testClassifyPromptId: string
  let testUniqueId: string

  beforeEach(async () => {
    // Generate unique suffix for this test run to avoid conflicts
    testUniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Create test import batch
    const importBatch = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'test-bundle.json',
        fileSizeBytes: 1000,
        timezone: 'UTC',
        statsJson: {
          message_count: 5,
          day_count: 1,
          coverage_start: '2024-01-15',
          coverage_end: '2024-01-15',
        },
      },
    })
    testImportBatchId = importBatch.id

    // Create test prompt version with unique name
    const classifyPrompt = await prisma.prompt.create({
      data: {
        stage: 'CLASSIFY',
        name: `Test Bundle Classify ${testUniqueId}`,
      },
    })
    testClassifyPromptId = classifyPrompt.id

    const classifyVersion = await prisma.promptVersion.create({
      data: {
        promptId: classifyPrompt.id,
        versionLabel: 'test-bundle-v1',
        templateText: 'Test classify prompt',
        isActive: true,
      },
    })
    testClassifyPromptVersionId = classifyVersion.id

    // Create raw entry
    const rawEntry = await prisma.rawEntry.create({
      data: {
        importBatchId: testImportBatchId,
        source: 'CHATGPT',
        dayDate: new Date('2024-01-15'),
        contentText: 'Test content for bundle day',
        contentHash: `test-hash-${testUniqueId}`,
      },
    })

    // Create atoms with different timestamps, sources, and roles
    // to verify sorting order: source ASC, timestampUtc ASC, role ASC (user before assistant), atomStableId ASC
    const baseTime = new Date('2024-01-15T10:00:00.000Z').getTime()

    const atoms = [
      { source: 'CHATGPT', time: baseTime + 2000, role: 'assistant', text: 'ChatGPT response', stableId: `${testUniqueId}-aaa-chatgpt-assistant-2` },
      { source: 'CHATGPT', time: baseTime + 1000, role: 'user', text: 'ChatGPT user query', stableId: `${testUniqueId}-bbb-chatgpt-user-1` },
      { source: 'CHATGPT', time: baseTime + 1000, role: 'assistant', text: 'ChatGPT early assistant', stableId: `${testUniqueId}-ccc-chatgpt-assistant-1` },
      { source: 'CLAUDE', time: baseTime, role: 'user', text: 'Claude user message', stableId: `${testUniqueId}-ddd-claude-user-0` },
      { source: 'CLAUDE', time: baseTime, role: 'assistant', text: 'Claude assistant message', stableId: `${testUniqueId}-eee-claude-assistant-0` },
    ]

    for (const atomData of atoms) {
      const atom = await prisma.messageAtom.create({
        data: {
          importBatchId: testImportBatchId,
          source: atomData.source as 'CHATGPT' | 'CLAUDE' | 'GROK',
          role: atomData.role.toUpperCase() as 'USER' | 'ASSISTANT',
          text: atomData.text,
          textHash: `text-hash-${atomData.stableId}`,
          timestampUtc: new Date(atomData.time),
          dayDate: new Date('2024-01-15'),
          atomStableId: atomData.stableId,
        },
      })

      // Create label that passes filter
      await prisma.messageLabel.create({
        data: {
          messageAtomId: atom.id,
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
          category: 'PERSONAL', confidence: 1.0,
        },
      })
    }
  })

  afterEach(async () => {
    // Clean up using IDs we know exist
    await prisma.messageLabel.deleteMany({
      where: { messageAtom: { importBatchId: testImportBatchId } },
    })
    await prisma.messageAtom.deleteMany({
      where: { importBatchId: testImportBatchId },
    })
    await prisma.rawEntry.deleteMany({
      where: { importBatchId: testImportBatchId },
    })
    await prisma.importBatch.deleteMany({
      where: { id: testImportBatchId },
    })
    if (testClassifyPromptVersionId) {
      await prisma.promptVersion.deleteMany({
        where: { id: testClassifyPromptVersionId },
      })
    }
    if (testClassifyPromptId) {
      await prisma.prompt.deleteMany({
        where: { id: testClassifyPromptId },
      })
    }
  })

  describe('buildBundle', () => {
    it('builds bundle with correct ordering per spec 9.1', async () => {
      const bundle = await buildBundle({
        importBatchId: testImportBatchId,
        dayDate: '2024-01-15',
        sources: ['chatgpt', 'claude'],
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: 'Test',
          mode: 'EXCLUDE',
          categories: ['WORK'],
        },
      })

      // Only user atoms: chatgpt-user-1, claude-user-0 (assistant atoms excluded per §9.1)
      expect(bundle.atomCount).toBe(2)

      // Source ordering: chatgpt before claude (alphabetical)
      expect(bundle.bundleText).toContain('# SOURCE: chatgpt')
      expect(bundle.bundleText).toContain('# SOURCE: claude')

      // The chatgpt section should come before claude (alphabetical)
      const chatgptIndex = bundle.bundleText.indexOf('# SOURCE: chatgpt')
      const claudeIndex = bundle.bundleText.indexOf('# SOURCE: claude')
      expect(chatgptIndex).toBeLessThan(claudeIndex)
    })

    it('generates stable bundleHash and bundleContextHash', async () => {
      const bundle1 = await buildBundle({
        importBatchId: testImportBatchId,
        dayDate: '2024-01-15',
        sources: ['chatgpt', 'claude'],
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: 'Test',
          mode: 'EXCLUDE',
          categories: ['WORK'],
        },
      })

      // Same input should produce same hashes
      const bundle2 = await buildBundle({
        importBatchId: testImportBatchId,
        dayDate: '2024-01-15',
        sources: ['chatgpt', 'claude'],
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: 'Test',
          mode: 'EXCLUDE',
          categories: ['WORK'],
        },
      })

      expect(bundle1.bundleHash).toBe(bundle2.bundleHash)
      expect(bundle1.bundleContextHash).toBe(bundle2.bundleContextHash)

      // Hashes should be hex strings
      expect(bundle1.bundleHash).toMatch(/^[a-f0-9]{64}$/)
      expect(bundle1.bundleContextHash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('filters atoms based on EXCLUDE mode', async () => {
      // Add an atom with 'coding' category that should be excluded
      const codingAtom = await prisma.messageAtom.create({
        data: {
          importBatchId: testImportBatchId,
          source: 'CHATGPT',
          role: 'USER',
          text: 'This is a coding message that should be excluded',
          textHash: `text-hash-${testUniqueId}-coding`,
          timestampUtc: new Date(),
          dayDate: new Date('2024-01-15'),
          atomStableId: `${testUniqueId}-coding-atom`,
        },
      })

      await prisma.messageLabel.create({
        data: {
          messageAtomId: codingAtom.id,
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
          category: 'WORK', confidence: 1.0, // This should be excluded
        },
      })

      const bundle = await buildBundle({
        importBatchId: testImportBatchId,
        dayDate: '2024-01-15',
        sources: ['chatgpt', 'claude'],
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: 'Test',
          mode: 'EXCLUDE',
          categories: ['WORK'],
        },
      })

      // Should not contain the coding message
      expect(bundle.bundleText).not.toContain('coding message that should be excluded')
      expect(bundle.atomCount).toBe(2) // Original 2 user atoms, not 3 (coding USER excluded)
    })

    it('filters atoms based on INCLUDE mode', async () => {
      const bundle = await buildBundle({
        importBatchId: testImportBatchId,
        dayDate: '2024-01-15',
        sources: ['chatgpt', 'claude'],
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: 'Test',
          mode: 'INCLUDE',
          categories: ['PERSONAL'], // Only include PERSONAL category
        },
      })

      // All user atoms have 'PERSONAL' category, so both user atoms included (assistant excluded)
      expect(bundle.atomCount).toBe(2)
    })

    it('returns empty bundle when no atoms match', async () => {
      const bundle = await buildBundle({
        importBatchId: testImportBatchId,
        dayDate: '2024-01-15',
        sources: ['chatgpt', 'claude'],
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: 'Test',
          mode: 'INCLUDE',
          categories: ['CREATIVE'], // Use a valid category that none of the atoms have
        },
      })

      expect(bundle.atomCount).toBe(0)
      expect(bundle.bundleText).toBe('')
    })

    it('respects source filter', async () => {
      const bundle = await buildBundle({
        importBatchId: testImportBatchId,
        dayDate: '2024-01-15',
        sources: ['chatgpt'], // Only chatgpt
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: 'Test',
          mode: 'EXCLUDE',
          categories: [],
        },
      })

      expect(bundle.bundleText).toContain('# SOURCE: chatgpt')
      expect(bundle.bundleText).not.toContain('# SOURCE: claude')
      expect(bundle.atomCount).toBe(1) // Only chatgpt user atom (assistant excluded)
    })

    it('excludes assistant atoms from bundle (SPEC §9.1: user-only)', async () => {
      const bundle = await buildBundle({
        importBatchId: testImportBatchId,
        dayDate: '2024-01-15',
        sources: ['chatgpt', 'claude'],
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: 'Test',
          mode: 'EXCLUDE',
          categories: ['WORK'],
        },
      })

      // Only user atoms should appear in the bundle
      // Fixture has: 2 user atoms (chatgpt-user-1, claude-user-0) and 3 assistant atoms
      expect(bundle.atomCount).toBe(2)

      // Verify no assistant text appears
      expect(bundle.bundleText).not.toContain('ChatGPT response')
      expect(bundle.bundleText).not.toContain('ChatGPT early assistant')
      expect(bundle.bundleText).not.toContain('Claude assistant message')

      // Verify user text does appear
      expect(bundle.bundleText).toContain('ChatGPT user query')
      expect(bundle.bundleText).toContain('Claude user message')
    })

    it('returns empty bundle when day has only assistant atoms', async () => {
      // Create a day with only an assistant atom
      const assistantAtom = await prisma.messageAtom.create({
        data: {
          importBatchId: testImportBatchId,
          source: 'CHATGPT',
          role: 'ASSISTANT',
          text: 'Only assistant on this day',
          textHash: `text-hash-${testUniqueId}-assistant-only`,
          timestampUtc: new Date('2024-01-16T10:00:00.000Z'),
          dayDate: new Date('2024-01-16'),
          atomStableId: `${testUniqueId}-assistant-only`,
        },
      })

      await prisma.messageLabel.create({
        data: {
          messageAtomId: assistantAtom.id,
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
          category: 'PERSONAL',
          confidence: 1.0,
        },
      })

      const bundle = await buildBundle({
        importBatchId: testImportBatchId,
        dayDate: '2024-01-16',
        sources: ['chatgpt'],
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: 'Test',
          mode: 'EXCLUDE',
          categories: [],
        },
      })

      expect(bundle.atomCount).toBe(0)
      expect(bundle.bundleText).toBe('')
    })

    it('excludes labeled assistant atom at same timestamp as user (SPEC §9.1)', async () => {
      // Even when an assistant atom is labeled and would pass the filter,
      // it MUST NOT appear in the bundle (user-only per §9.1).

      const sameTimestamp = new Date('2024-01-15T12:00:00.000Z')

      const assistantAtom = await prisma.messageAtom.create({
        data: {
          importBatchId: testImportBatchId,
          source: 'CHATGPT',
          role: 'ASSISTANT',
          text: 'I am the assistant response',
          textHash: `text-hash-${testUniqueId}-role-guard-assistant`,
          timestampUtc: sameTimestamp,
          dayDate: new Date('2024-01-15'),
          atomStableId: `${testUniqueId}-role-guard-assistant`,
        },
      })

      const userAtom = await prisma.messageAtom.create({
        data: {
          importBatchId: testImportBatchId,
          source: 'CHATGPT',
          role: 'USER',
          text: 'I am the user question',
          textHash: `text-hash-${testUniqueId}-role-guard-user`,
          timestampUtc: sameTimestamp,
          dayDate: new Date('2024-01-15'),
          atomStableId: `${testUniqueId}-role-guard-user`,
        },
      })

      await prisma.messageLabel.createMany({
        data: [
          {
            messageAtomId: assistantAtom.id,
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
            category: 'PERSONAL',
            confidence: 1.0,
          },
          {
            messageAtomId: userAtom.id,
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
            category: 'PERSONAL',
            confidence: 1.0,
          },
        ],
      })

      const bundle = await buildBundle({
        importBatchId: testImportBatchId,
        dayDate: '2024-01-15',
        sources: ['chatgpt'],
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: 'Test',
          mode: 'INCLUDE',
          categories: ['PERSONAL'],
        },
      })

      // User atom included, assistant atom excluded
      expect(bundle.bundleText).toContain('user question')
      expect(bundle.bundleText).not.toContain('assistant response')
    })
  })

  describe('estimateTokens', () => {
    it('estimates tokens as chars / 4', () => {
      const text = 'Hello world' // 11 chars
      expect(estimateTokens(text)).toBe(3) // ceil(11/4) = 3
    })

    it('handles empty string', () => {
      expect(estimateTokens('')).toBe(0)
    })
  })
})
