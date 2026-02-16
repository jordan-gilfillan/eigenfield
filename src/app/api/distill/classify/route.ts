/**
 * POST /api/distill/classify
 *
 * Classifies MessageAtoms in an ImportBatch.
 * Supports stub mode (deterministic) and real mode (LLM-based).
 *
 * Spec reference: 7.2, 7.9
 */

import { NextRequest, NextResponse } from 'next/server'
import { classifyBatch, InvalidInputError } from '@/lib/services/classify'
import { NotFoundError } from '@/lib/errors'
import { errors, errorResponse } from '@/lib/api-utils'
import { LlmError, BudgetExceededError, LlmBadOutputError } from '@/lib/llm'
import { requireField } from '@/lib/route-validate'

interface ClassifyRequest {
  importBatchId: string
  model: string
  promptVersionId: string
  mode: 'stub' | 'real'
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<ClassifyRequest>

    // Validate required fields
    const fail =
      requireField(body.importBatchId, 'importBatchId') ??
      requireField(body.model, 'model') ??
      requireField(body.promptVersionId, 'promptVersionId') ??
      requireField(body.mode, 'mode')
    if (fail) return errors.invalidInput(fail)

    if (body.mode !== 'stub' && body.mode !== 'real') {
      return errors.invalidInput('mode must be "stub" or "real"')
    }

    // Classify the batch
    const result = await classifyBatch({
      importBatchId: body.importBatchId!,
      model: body.model!,
      promptVersionId: body.promptVersionId!,
      mode: body.mode!,
    })

    // Return response per spec 7.9
    return NextResponse.json(result)
  } catch (error) {
    console.error('Classify error:', error)

    if (error instanceof InvalidInputError) {
      return errorResponse(400, error.code, error.message, error.details)
    }

    if (error instanceof BudgetExceededError) {
      return errorResponse(402, error.code, error.message, error.details)
    }

    if (error instanceof LlmBadOutputError) {
      return errorResponse(502, error.code, error.message, error.details)
    }

    if (error instanceof LlmError) {
      return errorResponse(500, error.code, error.message, error.details)
    }

    if (error instanceof NotFoundError) {
      return errors.notFound(error.resource)
    }

    return errors.internal()
  }
}
