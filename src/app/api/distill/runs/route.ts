/**
 * POST /api/distill/runs
 * GET /api/distill/runs
 *
 * Creates and lists runs.
 *
 * Spec reference: 7.3, 7.9
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRun } from '@/lib/services/run'
import { prisma } from '@/lib/db'
import { errors, errorResponse } from '@/lib/api-utils'
import { UnknownModelPricingError } from '@/lib/llm'

interface CreateRunRequest {
  importBatchId: string
  startDate: string
  endDate: string
  sources: string[]
  filterProfileId: string
  model: string
  labelSpec: {
    model: string
    promptVersionId: string
  }
  maxInputTokens?: number
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<CreateRunRequest>

    // Validate required fields
    if (!body.importBatchId) {
      return errors.invalidInput('importBatchId is required')
    }
    if (!body.startDate) {
      return errors.invalidInput('startDate is required')
    }
    if (!body.endDate) {
      return errors.invalidInput('endDate is required')
    }
    if (!body.sources || !Array.isArray(body.sources) || body.sources.length === 0) {
      return errors.invalidInput('sources is required and must be a non-empty array')
    }
    if (!body.filterProfileId) {
      return errors.invalidInput('filterProfileId is required')
    }
    if (!body.model) {
      return errors.invalidInput('model is required')
    }
    if (!body.labelSpec || !body.labelSpec.model || !body.labelSpec.promptVersionId) {
      return errors.invalidInput('labelSpec with model and promptVersionId is required')
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(body.startDate)) {
      return errors.invalidInput('startDate must be in YYYY-MM-DD format')
    }
    if (!dateRegex.test(body.endDate)) {
      return errors.invalidInput('endDate must be in YYYY-MM-DD format')
    }

    // Validate sources
    const validSources = ['chatgpt', 'claude', 'grok']
    for (const source of body.sources) {
      if (!validSources.includes(source.toLowerCase())) {
        return errors.invalidInput(`Invalid source: ${source}`, { validSources })
      }
    }

    // Create the run
    const result = await createRun({
      importBatchId: body.importBatchId,
      startDate: body.startDate,
      endDate: body.endDate,
      sources: body.sources.map((s) => s.toLowerCase()),
      filterProfileId: body.filterProfileId,
      model: body.model,
      labelSpec: body.labelSpec,
      maxInputTokens: body.maxInputTokens,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Create run error:', error)

    if (error instanceof UnknownModelPricingError) {
      return errorResponse(400, error.code, error.message, error.details)
    }

    if (error instanceof Error) {
      if (error.message.includes('ImportBatch not found')) {
        return errors.notFound('ImportBatch')
      }
      if (error.message.includes('FilterProfile not found')) {
        return errors.notFound('FilterProfile')
      }
      if (error.message.includes('promptVersionId not found')) {
        return errors.notFound('LabelSpec promptVersion')
      }
      if (error.message.includes('No active summarize prompt')) {
        return errors.invalidInput('No active summarize prompt version configured')
      }
      if (error.message.includes('NO_ELIGIBLE_DAYS')) {
        return NextResponse.json(
          {
            error: {
              code: 'NO_ELIGIBLE_DAYS',
              message: 'No days match the filter criteria',
            },
          },
          { status: 400 }
        )
      }
    }

    return errors.internal()
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const importBatchId = searchParams.get('importBatchId')
    const limitParam = searchParams.get('limit')
    const cursor = searchParams.get('cursor')

    // Parse limit
    let limit = 50
    if (limitParam) {
      limit = parseInt(limitParam, 10)
      if (isNaN(limit) || limit < 1) {
        return errors.invalidInput('limit must be a positive integer')
      }
      if (limit > 200) {
        limit = 200
      }
    }

    // Build query
    const where = importBatchId ? { importBatchId } : {}

    const runs = await prisma.run.findMany({
      where,
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      orderBy: { createdAt: 'desc' },
    })

    const hasMore = runs.length > limit
    const items = hasMore ? runs.slice(0, limit) : runs
    const nextCursor = hasMore ? items[items.length - 1].id : undefined

    return NextResponse.json({
      items: items.map((run) => ({
        id: run.id,
        status: run.status.toLowerCase(),
        importBatchId: run.importBatchId,
        model: run.model,
        createdAt: run.createdAt.toISOString(),
      })),
      nextCursor,
    })
  } catch (error) {
    console.error('List runs error:', error)
    return errors.internal()
  }
}
