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
import { errors, errorResponse } from '@/lib/api-utils'
import { LlmError, BudgetExceededError, LlmBadOutputError } from '@/lib/llm'

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
    if (!body.importBatchId) {
      return errors.invalidInput('importBatchId is required')
    }
    if (!body.model) {
      return errors.invalidInput('model is required')
    }
    if (!body.promptVersionId) {
      return errors.invalidInput('promptVersionId is required')
    }
    if (!body.mode) {
      return errors.invalidInput('mode is required')
    }
    if (body.mode !== 'stub' && body.mode !== 'real') {
      return errors.invalidInput('mode must be "stub" or "real"')
    }

    // Classify the batch
    const result = await classifyBatch({
      importBatchId: body.importBatchId,
      model: body.model,
      promptVersionId: body.promptVersionId,
      mode: body.mode,
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

    if (error instanceof Error) {
      if (error.message.includes('ImportBatch not found')) {
        return errors.notFound('ImportBatch')
      }
      if (error.message.includes('PromptVersion not found')) {
        return errors.notFound('PromptVersion')
      }
    }

    return errors.internal()
  }
}
