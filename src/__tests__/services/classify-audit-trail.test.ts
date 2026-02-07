import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '../../lib/db'
import { classifyBatch } from '../../lib/services/classify'
import { importExport } from '../../lib/services/import'
import * as llmModule from '../../lib/llm'
import { GET as getLastClassify } from '../../app/api/distill/import-batches/[id]/last-classify/route'
import { POST as postClassify } from '../../app/api/distill/classify/route'

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
    errorJson: {
      code: string
      message: string
      details?: Record<string, unknown>
    } | null
    finishedAt: string | null
  }
}

function createTestExport(messages: Array<{
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
  conversationId?: string
}>) {
  const mapping: Record<string, unknown> = {}

  messages.forEach((msg, i) => {
    mapping[`node-${i}`] = {
      id: `node-${i}`,
      message: {
        id: msg.id,
        author: { role: msg.role },
        create_time: msg.timestamp,
        content: {
          content_type: 'text',
          parts: [msg.text],
        },
      },
      parent: i > 0 ? `node-${i - 1}` : null,
      children: i < messages.length - 1 ? [`node-${i + 1}`] : [],
    }
  })

  return JSON.stringify([
    {
      title: 'Audit Trail Test Conversation',
      create_time: messages[0]?.timestamp ?? 1705316400,
      update_time: messages[messages.length - 1]?.timestamp ?? 1705316400,
      mapping,
      conversation_id: messages[0]?.conversationId ?? 'conv-audit-test',
    },
  ])
}

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
  let realPromptVersionId: string
  let stubPromptVersionId: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    process.env = { ...originalEnv }
    process.env.LLM_MIN_DELAY_MS = '0'

    const classifyPrompt = await prisma.prompt.upsert({
      where: { stage_name: { stage: 'CLASSIFY', name: 'default-classifier' } },
      update: {},
      create: {
        stage: 'CLASSIFY',
        name: 'default-classifier',
      },
    })

    const realPv = await prisma.promptVersion.upsert({
      where: {
        promptId_versionLabel: {
          promptId: classifyPrompt.id,
          versionLabel: 'classify_real_v1_audit_test',
        },
      },
      update: {
        templateText: 'Respond with JSON: {"category":"<CAT>","confidence":<0-1>}',
      },
      create: {
        promptId: classifyPrompt.id,
        versionLabel: 'classify_real_v1_audit_test',
        templateText: 'Respond with JSON: {"category":"<CAT>","confidence":<0-1>}',
        isActive: false,
      },
    })
    realPromptVersionId = realPv.id

    const stubPv = await prisma.promptVersion.upsert({
      where: {
        promptId_versionLabel: {
          promptId: classifyPrompt.id,
          versionLabel: 'classify_stub_v1',
        },
      },
      update: {
        templateText: 'STUB: Deterministic classification based on atomStableId hash.',
      },
      create: {
        promptId: classifyPrompt.id,
        versionLabel: 'classify_stub_v1',
        templateText: 'STUB: Deterministic classification based on atomStableId hash.',
        isActive: true,
      },
    })
    stubPromptVersionId = stubPv.id
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
  })

  it('persists failed status + partial counters + errorJson when callLlm throws mid-run', async () => {
    const messages = Array.from({ length: 130 }, (_, i) => ({
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
    expect(last.stats!.errorJson).toBeNull()
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
})
