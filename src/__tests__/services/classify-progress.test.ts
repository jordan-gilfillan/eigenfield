import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { ClassifyWarningDetails } from '../../lib/classify-warning-details'
import { prisma } from '../../lib/db'
import { classifyBatch } from '../../lib/services/classify'
import { importExport } from '../../lib/services/import'
import { resolveDefaultClassifyPromptVersion } from '../../lib/services/prompt-version-defaults'
import * as llmModule from '../../lib/llm'
import { GET as getClassifyRun } from '../../app/api/distill/classify-runs/[id]/route'
import { POST as postStopClassify } from '../../app/api/distill/classify-runs/[id]/stop/route'
import { POST as postClassify } from '../../app/api/distill/classify/route'
import { CANONICAL_PROMPT_TEMPLATES } from '../../lib/canonical-prompts'
import { createCanonicalPromptVersionFixture } from '../fixtures/prompt-fixtures'

/**
 * Integration tests for:
 * - POST /classify returns classifyRunId
 * - GET /classify-runs/:id returns correct shapes
 * - POST /classify-runs/:id/stop requests a foreground stop
 * - GET /classify-runs/:id is read-only (no side effects)
 * - Progress updates persist during execution
 */

import { createTestExport } from '../fixtures/export-factories'

async function callGetClassifyRun(id: string) {
  const req = new NextRequest(`http://localhost/api/distill/classify-runs/${id}`)
  return getClassifyRun(req, { params: Promise.resolve({ id }) })
}

async function callStopClassifyRun(id: string) {
  const req = new NextRequest(`http://localhost/api/distill/classify-runs/${id}/stop`, {
    method: 'POST',
  })
  return postStopClassify(req, { params: Promise.resolve({ id }) })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    void rej
  })
  return { promise, resolve }
}

describe('Classify progress + classify-runs endpoint', () => {
  const createdBatchIds: string[] = []
  const createdPromptVersionIds: string[] = []
  let stubPromptVersionId: string
  let realPromptVersionId: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    process.env = { ...originalEnv }
    delete process.env.LLM_MODE
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    process.env.LLM_MIN_DELAY_MS = '0'

    stubPromptVersionId = (await resolveDefaultClassifyPromptVersion('stub')).id

    const realPv = await createCanonicalPromptVersionFixture({
      stage: 'CLASSIFY',
      versionLabelBase: 'classify-real-progress-test',
      templateText:
        CANONICAL_PROMPT_TEMPLATES.CLASSIFY['default-classifier'].classify_real_v1,
    })
    createdPromptVersionIds.push(realPv.promptVersion.id)
    realPromptVersionId = realPv.promptVersion.id
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

  describe('POST /classify returns classifyRunId', () => {
    it('stub mode includes classifyRunId in response', async () => {
      const content = createTestExport([
        { id: 'msg-prog-stub-1', role: 'user', text: 'stub progress test', timestamp: 1705316400, conversationId: 'conv-prog-stub' },
        { id: 'msg-prog-stub-2', role: 'assistant', text: 'reply', timestamp: 1705316401, conversationId: 'conv-prog-stub' },
      ])

      const importResult = await importExport({
        content,
        filename: 'progress-stub.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const result = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: stubPromptVersionId,
        mode: 'stub',
      })

      expect(result.classifyRunId).toBeDefined()
      expect(typeof result.classifyRunId).toBe('string')
      expect(result.classifyRunId.length).toBeGreaterThan(0)

      // Verify classifyRunId references a real ClassifyRun
      const cr = await prisma.classifyRun.findUnique({
        where: { id: result.classifyRunId },
      })
      expect(cr).not.toBeNull()
      expect(cr!.status).toBe('succeeded')
    })

    it('real mode includes classifyRunId in response', async () => {
      const content = createTestExport([
        { id: 'msg-prog-real-1', role: 'user', text: 'real progress test', timestamp: 1705316500, conversationId: 'conv-prog-real' },
      ])

      const importResult = await importExport({
        content,
        filename: 'progress-real.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const result = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      expect(result.classifyRunId).toBeDefined()
      expect(typeof result.classifyRunId).toBe('string')
    })

    it('POST /classify route response includes classifyRunId', async () => {
      const content = createTestExport([
        { id: 'msg-prog-route-1', role: 'user', text: 'route test', timestamp: 1705316600, conversationId: 'conv-prog-route' },
      ])

      const importResult = await importExport({
        content,
        filename: 'progress-route.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const req = new NextRequest('http://localhost/api/distill/classify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          importBatchId: importResult.importBatch.id,
          model: 'stub_v1',
          promptVersionId: stubPromptVersionId,
          mode: 'stub',
        }),
      })

      const res = await postClassify(req)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.classifyRunId).toBeDefined()
      expect(typeof body.classifyRunId).toBe('string')
      expect(body.importBatchId).toBe(importResult.importBatch.id)
    })

    it('POST /classify route honors a client-supplied classifyRunId', async () => {
      const content = createTestExport([
        { id: 'msg-prog-route-client-id-1', role: 'user', text: 'route test with client id', timestamp: 1705316605, conversationId: 'conv-prog-route-client-id' },
      ])

      const importResult = await importExport({
        content,
        filename: 'progress-route-client-id.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const classifyRunId = `client-run-${Date.now()}`
      const req = new NextRequest('http://localhost/api/distill/classify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classifyRunId,
          importBatchId: importResult.importBatch.id,
          model: 'stub_v1',
          promptVersionId: stubPromptVersionId,
          mode: 'stub',
        }),
      })

      const res = await postClassify(req)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.classifyRunId).toBe(classifyRunId)

      const classifyRun = await prisma.classifyRun.findUnique({
        where: { id: classifyRunId },
      })
      expect(classifyRun).not.toBeNull()
      expect(classifyRun!.importBatchId).toBe(importResult.importBatch.id)
    })
  })

  describe('GET /classify-runs/:id', () => {
    it('returns succeeded shape for completed classify', async () => {
      const content = createTestExport([
        { id: 'msg-cr-get-1', role: 'user', text: 'get test', timestamp: 1705316700, conversationId: 'conv-cr-get' },
        { id: 'msg-cr-get-2', role: 'assistant', text: 'reply', timestamp: 1705316701, conversationId: 'conv-cr-get' },
      ])

      const importResult = await importExport({
        content,
        filename: 'cr-get.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const classifyResult = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: stubPromptVersionId,
        mode: 'stub',
      })

      const res = await callGetClassifyRun(classifyResult.classifyRunId)
      expect(res.status).toBe(200)

      const body = await res.json()

      // Verify shape
      expect(body.id).toBe(classifyResult.classifyRunId)
      expect(body.importBatchId).toBe(importResult.importBatch.id)
      expect(body.labelSpec).toEqual({
        model: 'stub_v1',
        promptVersionId: stubPromptVersionId,
        promptVersionLabel: 'classify_stub_v1',
        promptName: 'default-classifier',
      })
      expect(body.mode).toBe('stub')
      expect(body.status).toBe('succeeded')

      // Totals
      expect(body.totals).toBeDefined()
      expect(body.totals.messageAtoms).toBe(1)
      expect(body.totals.newlyLabeled).toBe(1)

      // Progress
      expect(body.progress).toBeDefined()
      expect(body.progress.processedAtoms).toBe(body.progress.totalAtoms)

      // Usage (null for stub)
      expect(body.usage).toBeDefined()
      expect(body.usage.tokensIn).toBeNull()
      expect(body.usage.tokensOut).toBeNull()
      expect(body.usage.costUsd).toBeNull()

      // Warnings
      expect(body.warnings).toBeDefined()
      expect(body.warnings.skippedBadOutput).toBe(0)
      expect(body.warnings.details).toBeUndefined()
      expect(body.control).toEqual({ canStop: false, stopRequested: false })
      expect(typeof body.checkpoint.lastAtomStableIdProcessed).toBe('string')

      // Timestamps
      expect(body.createdAt).toBeDefined()
      expect(body.updatedAt).toBeDefined()
      expect(body.startedAt).toBeDefined()
      expect(body.finishedAt).toBeTruthy()

      // No error
      expect(body.lastError).toBeNull()
    })

    it('response shape matches SPEC §7.2.1 (progress + warnings split)', async () => {
      const content = createTestExport([
        { id: 'msg-cr-shape-1', role: 'user', text: 'shape test', timestamp: 1705316750, conversationId: 'conv-cr-shape' },
        { id: 'msg-cr-shape-2', role: 'assistant', text: 'reply', timestamp: 1705316751, conversationId: 'conv-cr-shape' },
      ])

      const importResult = await importExport({
        content,
        filename: 'cr-shape.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const classifyResult = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: stubPromptVersionId,
        mode: 'stub',
      })

      const res = await callGetClassifyRun(classifyResult.classifyRunId)
      const body = await res.json()

      // SPEC §7.2.1: progress contains ONLY progress counters
      expect(Object.keys(body.progress).sort()).toEqual(['processedAtoms', 'totalAtoms'])

      // SPEC §7.2.1: warnings is a separate top-level key with quality counters
      expect(Object.keys(body.warnings).sort()).toEqual(['aliasedCount', 'skippedBadOutput'])
      expect(Object.keys(body.checkpoint).sort()).toEqual(['lastAtomStableIdProcessed'])
      expect(Object.keys(body.control).sort()).toEqual(['canStop', 'stopRequested'])

      // Ensure skippedBadOutput/aliasedCount are NOT in progress
      expect(body.progress).not.toHaveProperty('skippedBadOutput')
      expect(body.progress).not.toHaveProperty('aliasedCount')

      // Top-level response keys match normative schema
      const expectedKeys = [
        'id', 'importBatchId', 'labelSpec', 'mode', 'status',
        'totals', 'progress', 'usage', 'warnings', 'checkpoint', 'control', 'lastError',
        'createdAt', 'updatedAt', 'startedAt', 'finishedAt',
      ].sort()
      expect(Object.keys(body).sort()).toEqual(expectedKeys)
    })

    it('returns 404 for non-existent classify run', async () => {
      const res = await callGetClassifyRun('nonexistent-id')
      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('returns failed shape with lastError for failed classify', async () => {
      const messages = Array.from({ length: 5 }, (_, i) => ({
        id: `msg-cr-fail-${i + 1}`,
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        text: `message ${i + 1}`,
        timestamp: 1705316800 + i,
        conversationId: 'conv-cr-fail',
      }))
      const content = createTestExport(messages)

      const importResult = await importExport({
        content,
        filename: 'cr-fail.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      let callCount = 0
      vi.spyOn(llmModule, 'callLlm').mockImplementation(async () => {
        callCount += 1
        if (callCount <= 2) {
          return {
            text: '{"category":"WORK","confidence":0.8}',
            tokensIn: 10,
            tokensOut: 8,
            costUsd: 0.001,
            dryRun: false,
          }
        }
        throw Object.assign(new Error('test failure'), { code: 'TEST_FAIL' })
      })

      await expect(
        classifyBatch({
          importBatchId: importResult.importBatch.id,
          model: 'gpt-4o',
          promptVersionId: realPromptVersionId,
          mode: 'real',
        })
      ).rejects.toThrow('test failure')

      // Find the classify run
      const cr = await prisma.classifyRun.findFirst({
        where: { importBatchId: importResult.importBatch.id, model: 'gpt-4o' },
      })
      expect(cr).not.toBeNull()

      const res = await callGetClassifyRun(cr!.id)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.status).toBe('failed')
      expect(body.lastError).toBeTruthy()
      expect(body.lastError.code).toBe('TEST_FAIL')
      expect(body.finishedAt).toBeTruthy()
    })

    it('returns persisted warning details while running and after completion', async () => {
      const messages = Array.from({ length: 209 }, (_, i) => ({
        id: `msg-cr-warn-${i + 1}`,
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        text: `warning message ${i + 1}`,
        timestamp: 1705316810 + i,
        conversationId: 'conv-cr-warn',
      }))
      const content = createTestExport(messages)

      const importResult = await importExport({
        content,
        filename: 'cr-warn.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const classifyRunId = `warn-run-${Date.now()}`
      const deferredSuccess = deferred<{
        text: string
        tokensIn: number
        tokensOut: number
        costUsd: number
        dryRun: boolean
      }>()
      let callCount = 0
      let holdPointSeen!: () => void
      const holdPointStarted = new Promise<void>((resolve) => {
        holdPointSeen = resolve
      })

      vi.spyOn(llmModule, 'callLlm').mockImplementation(async () => {
        callCount += 1
        if (callCount <= 100) {
          return {
            text: '{"category":"GALACTIC","confidence":0.61}',
            tokensIn: 10,
            tokensOut: 10,
            costUsd: 0.001,
            dryRun: false,
          }
        }
        if (callCount === 101) {
          holdPointSeen()
          return deferredSuccess.promise
        }
        return {
          text: '{"category":"WORK","confidence":0.8}',
          tokensIn: 10,
          tokensOut: 10,
          costUsd: 0.001,
          dryRun: false,
        }
      })

      const classifyPromise = classifyBatch({
        classifyRunId,
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      await holdPointStarted

      const midRes = await callGetClassifyRun(classifyRunId)
      expect(midRes.status).toBe(200)
      const midBody = await midRes.json()
      const midDetails = midBody.warnings.details as ClassifyWarningDetails | undefined

      expect(midBody.status).toBe('running')
      expect(midBody.warnings.skippedBadOutput).toBe(100)
      expect(midDetails).toBeDefined()
      expect(midDetails?.badOutputReasons.invalid_category_value).toBe(100)
      expect(midDetails?.badCategorySamples).toEqual(['GALACTIC'])

      deferredSuccess.resolve({
        text: '{"category":"WORK","confidence":0.8}',
        tokensIn: 10,
        tokensOut: 10,
        costUsd: 0.001,
        dryRun: false,
      })

      const result = await classifyPromise
      expect(result.totals.newlyLabeled).toBe(5)

      const finalRes = await callGetClassifyRun(classifyRunId)
      expect(finalRes.status).toBe(200)
      const finalBody = await finalRes.json()
      const finalDetails = finalBody.warnings.details as ClassifyWarningDetails | undefined

      expect(finalBody.status).toBe('succeeded')
      expect(finalBody.warnings.skippedBadOutput).toBe(100)
      expect(finalDetails?.badOutputReasons.invalid_category_value).toBe(100)
      expect(finalDetails?.badCategorySamples).toEqual(['GALACTIC'])
      expect(finalDetails?.aliasedCategorySamples).toEqual([])
    })
  })

  describe('POST /classify-runs/:id/stop', () => {
    it('requests stop for a running classify and persists a stopped-by-user terminal result', async () => {
      const content = createTestExport([
        { id: 'msg-stop-1', role: 'user', text: 'stop test 1', timestamp: 1705317200, conversationId: 'conv-stop' },
        { id: 'msg-stop-2', role: 'assistant', text: 'stop test 2', timestamp: 1705317201, conversationId: 'conv-stop' },
        { id: 'msg-stop-3', role: 'user', text: 'stop test 3', timestamp: 1705317202, conversationId: 'conv-stop' },
      ])

      const importResult = await importExport({
        content,
        filename: 'stop.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const classifyRunId = `stop-run-${Date.now()}`
      const firstResponse = deferred<{
        text: string
        tokensIn: number
        tokensOut: number
        costUsd: number
        dryRun: boolean
      }>()
      let callCount = 0
      let firstCallSeen!: () => void
      const firstCallStarted = new Promise<void>((resolve) => {
        firstCallSeen = resolve
      })

      vi.spyOn(llmModule, 'callLlm').mockImplementation(async () => {
        callCount += 1
        if (callCount === 1) {
          firstCallSeen()
          return firstResponse.promise
        }
        return {
          text: '{"category":"WORK","confidence":0.8}',
          tokensIn: 10,
          tokensOut: 8,
          costUsd: 0.001,
          dryRun: false,
        }
      })

      const classifyPromise = classifyBatch({
        classifyRunId,
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      await firstCallStarted

      const stopRes = await callStopClassifyRun(classifyRunId)
      expect(stopRes.status).toBe(200)
      const stopBody = await stopRes.json()
      expect(stopBody).toEqual({
        id: classifyRunId,
        status: 'running',
        stopRequested: true,
      })

      const midRes = await callGetClassifyRun(classifyRunId)
      const midBody = await midRes.json()
      expect(midBody.control).toEqual({ canStop: true, stopRequested: true })
      expect(midBody.lastError).toBeNull()

      firstResponse.resolve({
        text: '{"category":"WORK","confidence":0.8}',
        tokensIn: 10,
        tokensOut: 8,
        costUsd: 0.001,
        dryRun: false,
      })

      await expect(classifyPromise).rejects.toMatchObject({
        code: 'USER_STOPPED',
      })
      expect(callCount).toBe(1)

      const finalRes = await callGetClassifyRun(classifyRunId)
      expect(finalRes.status).toBe(200)
      const finalBody = await finalRes.json()
      expect(finalBody.status).toBe('failed')
      expect(finalBody.progress.processedAtoms).toBe(1)
      expect(finalBody.totals.newlyLabeled).toBe(1)
      expect(finalBody.control).toEqual({ canStop: false, stopRequested: false })
      expect(finalBody.lastError).toMatchObject({
        code: 'USER_STOPPED',
      })
      expect(finalBody.finishedAt).toBeTruthy()
    })
  })

  describe('GET /classify-runs/:id is read-only', () => {
    it('does not create labels or mutate when called multiple times', async () => {
      const content = createTestExport([
        { id: 'msg-readonly-1', role: 'user', text: 'readonly test', timestamp: 1705316900, conversationId: 'conv-readonly' },
      ])

      const importResult = await importExport({
        content,
        filename: 'readonly.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const result = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: stubPromptVersionId,
        mode: 'stub',
      })

      // Snapshot state before GET calls
      const labelCountBefore = await prisma.messageLabel.count({
        where: { messageAtom: { importBatchId: importResult.importBatch.id } },
      })
      const runCountBefore = await prisma.classifyRun.count({
        where: { importBatchId: importResult.importBatch.id },
      })
      const crBefore = await prisma.classifyRun.findUnique({
        where: { id: result.classifyRunId },
      })

      // Call GET multiple times
      for (let i = 0; i < 3; i++) {
        const res = await callGetClassifyRun(result.classifyRunId)
        expect(res.status).toBe(200)
      }

      // Verify nothing changed
      const labelCountAfter = await prisma.messageLabel.count({
        where: { messageAtom: { importBatchId: importResult.importBatch.id } },
      })
      const runCountAfter = await prisma.classifyRun.count({
        where: { importBatchId: importResult.importBatch.id },
      })
      const crAfter = await prisma.classifyRun.findUnique({
        where: { id: result.classifyRunId },
      })

      expect(labelCountAfter).toBe(labelCountBefore)
      expect(runCountAfter).toBe(runCountBefore)
      expect(crAfter!.processedAtoms).toBe(crBefore!.processedAtoms)
      expect(crAfter!.newlyLabeled).toBe(crBefore!.newlyLabeled)
    })
  })

  describe('progress persistence during execution', () => {
    it('processedAtoms is bounded by totalAtoms at completion', async () => {
      const content = createTestExport([
        { id: 'msg-bound-1', role: 'user', text: 'bound test 1', timestamp: 1705317000, conversationId: 'conv-bound' },
        { id: 'msg-bound-2', role: 'assistant', text: 'reply', timestamp: 1705317001, conversationId: 'conv-bound' },
        { id: 'msg-bound-3', role: 'user', text: 'bound test 2', timestamp: 1705317002, conversationId: 'conv-bound' },
      ])

      const importResult = await importExport({
        content,
        filename: 'bound.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const result = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: stubPromptVersionId,
        mode: 'stub',
      })

      const cr = await prisma.classifyRun.findUnique({
        where: { id: result.classifyRunId },
      })

      expect(cr).not.toBeNull()
      expect(cr!.status).toBe('succeeded')
      expect(cr!.processedAtoms).toBe(cr!.totalAtoms)
      expect(cr!.processedAtoms).toBe(2)
      expect(cr!.finishedAt).toBeTruthy()
    })

    it('real mode records tokens and cost at completion', async () => {
      const content = createTestExport([
        { id: 'msg-usage-1', role: 'user', text: 'usage test', timestamp: 1705317100, conversationId: 'conv-usage' },
        { id: 'msg-usage-2', role: 'assistant', text: 'reply', timestamp: 1705317101, conversationId: 'conv-usage' },
      ])

      const importResult = await importExport({
        content,
        filename: 'usage.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      vi.spyOn(llmModule, 'callLlm').mockImplementation(async () => ({
        text: '{"category":"LEARNING","confidence":0.9}',
        tokensIn: 50,
        tokensOut: 20,
        costUsd: 0.005,
        dryRun: false,
      }))

      const result = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      const res = await callGetClassifyRun(result.classifyRunId)
      const body = await res.json()

      expect(body.usage.tokensIn).toBe(50) // 1 user atom x 50
      expect(body.usage.tokensOut).toBe(20) // 1 user atom x 20
      expect(body.usage.costUsd).toBeCloseTo(0.005) // 1 user atom x 0.005
    })

    it('empty batch classifyRunId references a completed run with 0 atoms', async () => {
      const batch = await prisma.importBatch.create({
        data: {
          source: 'CHATGPT',
          originalFilename: 'empty-progress.json',
          fileSizeBytes: 0,
          timezone: 'UTC',
          statsJson: {
            message_count: 0,
            day_count: 0,
            coverage_start: '',
            coverage_end: '',
            per_source_counts: {},
          },
        },
      })
      createdBatchIds.push(batch.id)

      const result = await classifyBatch({
        importBatchId: batch.id,
        model: 'stub_v1',
        promptVersionId: stubPromptVersionId,
        mode: 'stub',
      })

      expect(result.classifyRunId).toBeDefined()

      const res = await callGetClassifyRun(result.classifyRunId)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.status).toBe('succeeded')
      expect(body.progress.processedAtoms).toBe(0)
      expect(body.progress.totalAtoms).toBe(0)
    })
  })
})
