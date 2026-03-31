import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { ClassifyWarningDetails } from '../../lib/classify-warning-details'
import { prisma } from '../../lib/db'
import { classifyBatch } from '../../lib/services/classify'
import { importExport } from '../../lib/services/import'
import { resolveDefaultClassifyPromptVersion } from '../../lib/services/prompt-version-defaults'
import * as llmModule from '../../lib/llm'
import { GET as getLastClassify } from '../../app/api/distill/import-batches/[id]/last-classify/route'
import { POST as postClassify } from '../../app/api/distill/classify/route'
import { CANONICAL_PROMPT_TEMPLATES } from '../../lib/canonical-prompts'
import { createCanonicalPromptVersionFixture } from '../fixtures/prompt-fixtures'

interface LastClassifyResponse {
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
    mode: string
    promptVersionLabel: string
    promptName: string
    warningDetails?: ClassifyWarningDetails
    errorJson: {
      code: string
      message: string
      details?: Record<string, unknown>
    } | null
    finishedAt: string | null
  }
}

import { createTestExport } from '../fixtures/export-factories'

async function fetchLastClassify(
  importBatchId: string,
  model: string,
  promptVersionId: string,
): Promise<LastClassifyResponse> {
  const req = new NextRequest(
    `http://localhost/api/distill/import-batches/${importBatchId}/last-classify?model=${encodeURIComponent(model)}&promptVersionId=${encodeURIComponent(promptVersionId)}`,
  )

  const res = await getLastClassify(req, { params: Promise.resolve({ id: importBatchId }) })
  expect(res.status).toBe(200)
  return res.json() as Promise<LastClassifyResponse>
}

describe('ClassifyRun audit trail', () => {
  const createdBatchIds: string[] = []
  const createdPromptVersionIds: string[] = []
  let realPromptVersionId: string
  let stubPromptVersionId: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    process.env = { ...originalEnv }
    delete process.env.LLM_MODE
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    process.env.LLM_MIN_DELAY_MS = '0'

    const realPv = await createCanonicalPromptVersionFixture({
      stage: 'CLASSIFY',
      versionLabelBase: 'classify-real-audit-test',
      templateText:
        CANONICAL_PROMPT_TEMPLATES.CLASSIFY['default-classifier'].classify_real_v1,
    })
    createdPromptVersionIds.push(realPv.promptVersion.id)
    realPromptVersionId = realPv.promptVersion.id

    stubPromptVersionId = (await resolveDefaultClassifyPromptVersion('stub')).id
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()

    for (const id of createdBatchIds) {
      await prisma.classifyRun.deleteMany({ where: { importBatchId: id } })
      await prisma.messageLabel.deleteMany({ where: { messageAtom: { importBatchId: id } } })
      await prisma.rawEntry.deleteMany({ where: { importBatchId: id } })
      await prisma.messageAtom.deleteMany({ where: { importBatchId: id } })
      await prisma.importBatch.delete({ where: { id } }).catch(() => {})
    }
    createdBatchIds.length = 0

    for (const id of createdPromptVersionIds) {
      await prisma.classifyRun.deleteMany({ where: { promptVersionId: id } })
      await prisma.messageLabel.deleteMany({ where: { promptVersionId: id } })
      await prisma.promptVersion.delete({ where: { id } }).catch(() => {})
    }
    createdPromptVersionIds.length = 0
  })

  it('persists failed status + partial counters + errorJson when callLlm throws mid-run', async () => {
    const messages = Array.from({ length: 211 }, (_, i) => ({
      id: `msg-audit-fail-${i + 1}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `message ${i + 1}`,
      timestamp: 1705316400 + i,
      conversationId: 'conv-audit-fail',
    }))
    const content = createTestExport(messages)

    const importResult = await importExport({
      content,
      filename: 'audit-fail.json',
      fileSizeBytes: content.length,
    })
    createdBatchIds.push(importResult.importBatch.id)

    let callCount = 0
    vi.spyOn(llmModule, 'callLlm').mockImplementation(async () => {
      callCount += 1
      if (callCount <= 105) {
        return {
          text: '{"category":"WORK","confidence":0.8}',
          tokensIn: 12,
          tokensOut: 8,
          costUsd: 0.001,
          dryRun: false,
        }
      }

      const err = Object.assign(new Error('simulated mid-run failure'), {
        code: 'SIM_FAIL',
        details: { stage: 'classify', payload: 'x'.repeat(5000) },
      })
      throw err
    })

    await expect(
      classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })
    ).rejects.toThrow('simulated mid-run failure')

    const last = await fetchLastClassify(importResult.importBatch.id, 'gpt-4o', realPromptVersionId)

    expect(last.hasStats).toBe(true)
    expect(last.stats).toBeDefined()
    expect(last.stats!.status).toBe('failed')
    expect(last.stats!.processedAtoms).toBeGreaterThan(0)
    expect(last.stats!.processedAtoms).toBeGreaterThanOrEqual(100)
    expect(last.stats!.processedAtoms).toBeLessThan(last.stats!.totalAtoms)
    expect(last.stats!.newlyLabeled).toBeGreaterThan(0)
    expect(last.stats!.labeledTotal).toBeGreaterThan(0)
    expect(last.stats!.finishedAt).toBeTruthy()
    expect(last.stats!.errorJson).toBeTruthy()
    expect(last.stats!.errorJson!.code).toBe('SIM_FAIL')
    expect(last.stats!.errorJson!.message).toContain('simulated mid-run failure')
  })

  it('returns status=succeeded on successful classify', async () => {
    const content = createTestExport([
      { id: 'msg-audit-ok-1', role: 'user', text: 'success path', timestamp: 1705316500, conversationId: 'conv-audit-ok' },
    ])

    const importResult = await importExport({
      content,
      filename: 'audit-ok.json',
      fileSizeBytes: content.length,
    })
    createdBatchIds.push(importResult.importBatch.id)

    await classifyBatch({
      importBatchId: importResult.importBatch.id,
      model: 'gpt-4o',
      promptVersionId: realPromptVersionId,
      mode: 'real',
    })

    const last = await fetchLastClassify(importResult.importBatch.id, 'gpt-4o', realPromptVersionId)

    expect(last.hasStats).toBe(true)
    expect(last.stats).toBeDefined()
    expect(last.stats!.status).toBe('succeeded')
    expect(last.stats!.processedAtoms).toBe(last.stats!.totalAtoms)
    expect(last.stats!.promptVersionLabel).toContain('classify-real-audit-test')
    expect(last.stats!.promptName).toBe('default-classifier')
    expect(last.stats!.warningDetails).toBeUndefined()
    expect(last.stats!.errorJson).toBeNull()
  })

  it('persists safe warningDetails on last-classify responses', async () => {
    const content = createTestExport([
      { id: 'msg-audit-warn-1', role: 'user', text: 'invalid category path', timestamp: 1705316510, conversationId: 'conv-audit-warn' },
      { id: 'msg-audit-warn-2', role: 'user', text: 'alias path', timestamp: 1705316511, conversationId: 'conv-audit-warn' },
    ])

    const importResult = await importExport({
      content,
      filename: 'audit-warn.json',
      fileSizeBytes: content.length,
    })
    createdBatchIds.push(importResult.importBatch.id)

    let callCount = 0
    vi.spyOn(llmModule, 'callLlm').mockImplementation(async () => {
      callCount += 1
      if (callCount === 1) {
        return {
          text: '{"category":"GALACTIC","confidence":0.61}',
          tokensIn: 10,
          tokensOut: 10,
          costUsd: 0.001,
          dryRun: false,
        }
      }
      return {
        text: '{"category":"ETHICAL","confidence":0.75}',
        tokensIn: 10,
        tokensOut: 10,
        costUsd: 0.001,
        dryRun: false,
      }
    })

    const result = await classifyBatch({
      importBatchId: importResult.importBatch.id,
      model: 'gpt-4o',
      promptVersionId: realPromptVersionId,
      mode: 'real',
    })

    expect(result.totals.newlyLabeled).toBe(1)

    const last = await fetchLastClassify(importResult.importBatch.id, 'gpt-4o', realPromptVersionId)

    expect(last.hasStats).toBe(true)
    expect(last.stats?.skippedBadOutput).toBe(1)
    expect(last.stats?.aliasedCount).toBe(1)
    expect(last.stats?.warningDetails).toEqual({
      badOutputReasons: {
        invalid_json: 0,
        non_object: 0,
        bad_category_field: 0,
        invalid_category_value: 1,
        bad_confidence_field: 0,
        confidence_out_of_range: 0,
      },
      badCategorySamples: ['GALACTIC'],
      aliasedCategorySamples: ['ETHICAL'],
    })
    expect(JSON.stringify(last.stats?.warningDetails)).not.toContain('rawOutput')
    expect(JSON.stringify(last.stats?.warningDetails)).not.toContain('invalid category path')
  })

  it('preflight invalid input returns 400 and does not create ClassifyRun', async () => {
    const content = createTestExport([
      { id: 'msg-audit-preflight-1', role: 'user', text: 'preflight fail', timestamp: 1705316600, conversationId: 'conv-audit-preflight' },
    ])

    const importResult = await importExport({
      content,
      filename: 'audit-preflight.json',
      fileSizeBytes: content.length,
    })
    createdBatchIds.push(importResult.importBatch.id)

    const llmSpy = vi.spyOn(llmModule, 'callLlm')

    const req = new NextRequest('http://localhost/api/distill/classify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: stubPromptVersionId,
        mode: 'real',
      }),
    })

    const res = await postClassify(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error?.code).toBe('INVALID_INPUT')
    expect(llmSpy).not.toHaveBeenCalled()

    const runCount = await prisma.classifyRun.count({
      where: {
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: stubPromptVersionId,
      },
    })

    expect(runCount).toBe(0)
  })

  it('two batches: only one classified → endpoint returns per-batch correct results', async () => {
    // Batch A — will be classified
    const contentA = createTestExport([
      { id: 'msg-scope-a-1', role: 'user', text: 'Batch A message', timestamp: 1705316400, conversationId: 'conv-scope-a' },
    ])
    const importA = await importExport({
      content: contentA,
      filename: 'scope-a.json',
      fileSizeBytes: contentA.length,
    })
    createdBatchIds.push(importA.importBatch.id)

    // Batch B — will NOT be classified
    const contentB = createTestExport([
      { id: 'msg-scope-b-1', role: 'user', text: 'Batch B message', timestamp: 1705316500, conversationId: 'conv-scope-b' },
    ])
    const importB = await importExport({
      content: contentB,
      filename: 'scope-b.json',
      fileSizeBytes: contentB.length,
    })
    createdBatchIds.push(importB.importBatch.id)

    // Classify only batch A
    await classifyBatch({
      importBatchId: importA.importBatch.id,
      model: 'stub_v1',
      promptVersionId: stubPromptVersionId,
      mode: 'stub',
    })

    // Batch A → hasStats: true (classified)
    const lastA = await fetchLastClassify(importA.importBatch.id, 'stub_v1', stubPromptVersionId)
    expect(lastA.hasStats).toBe(true)
    expect(lastA.stats).toBeDefined()
    expect(lastA.stats!.status).toBe('succeeded')
    expect(lastA.stats!.totalAtoms).toBeGreaterThan(0)

    // Batch B → hasStats: false (not classified)
    const lastB = await fetchLastClassify(importB.importBatch.id, 'stub_v1', stubPromptVersionId)
    expect(lastB.hasStats).toBe(false)
    expect(lastB.stats).toBeUndefined()
  })

  it('classify stats for one batch do not leak to another batch', async () => {
    // Create two batches and classify both with different models
    const contentA = createTestExport([
      { id: 'msg-leak-a-1', role: 'user', text: 'Leak test A', timestamp: 1705316400, conversationId: 'conv-leak-a' },
      { id: 'msg-leak-a-2', role: 'assistant', text: 'Reply A', timestamp: 1705316401, conversationId: 'conv-leak-a' },
    ])
    const importA = await importExport({
      content: contentA,
      filename: 'leak-a.json',
      fileSizeBytes: contentA.length,
    })
    createdBatchIds.push(importA.importBatch.id)

    const contentB = createTestExport([
      { id: 'msg-leak-b-1', role: 'user', text: 'Leak test B', timestamp: 1705316500, conversationId: 'conv-leak-b' },
    ])
    const importB = await importExport({
      content: contentB,
      filename: 'leak-b.json',
      fileSizeBytes: contentB.length,
    })
    createdBatchIds.push(importB.importBatch.id)

    // Classify batch A only (stub mode)
    await classifyBatch({
      importBatchId: importA.importBatch.id,
      model: 'stub_v1',
      promptVersionId: stubPromptVersionId,
      mode: 'stub',
    })

    // Query batch A with correct label spec → gets stats
    const lastA = await fetchLastClassify(importA.importBatch.id, 'stub_v1', stubPromptVersionId)
    expect(lastA.hasStats).toBe(true)
    expect(lastA.stats!.totalAtoms).toBe(1)

    // Query batch B with same label spec → no stats (not classified)
    const lastB = await fetchLastClassify(importB.importBatch.id, 'stub_v1', stubPromptVersionId)
    expect(lastB.hasStats).toBe(false)

    // Query batch A with wrong model → no stats (different label spec)
    const lastAWrong = await fetchLastClassify(importA.importBatch.id, 'gpt-4o', stubPromptVersionId)
    expect(lastAWrong.hasStats).toBe(false)
  })
})
