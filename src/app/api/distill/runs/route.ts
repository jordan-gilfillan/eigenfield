/**
 * POST /api/distill/runs
 * GET /api/distill/runs
 *
 * Creates and lists runs.
 *
 * Spec reference: 7.3, 7.9
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRun, TimezoneMismatchError } from '@/lib/services/run'
import { prisma } from '@/lib/db'
import { errors, errorResponse } from '@/lib/api-utils'
import { UnknownModelPricingError } from '@/lib/llm'
import { NotFoundError, ServiceError } from '@/lib/errors'
import {
  requireField,
  requireXor,
  requireNonEmptyArray,
  validateNonEmptyArray,
  requireUniqueArray,
  requireDateFormat,
} from '@/lib/route-validate'

interface CreateRunRequest {
  importBatchId?: string
  importBatchIds?: string[]
  startDate: string
  endDate: string
  sources: string[]
  filterProfileId: string
  model: string
  labelSpec?: {
    model: string
    promptVersionId: string
  }
  maxInputTokens?: number
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<CreateRunRequest>

    // Validate required fields and shapes (SPEC §7.3 step 0a)
    const fail =
      requireXor(
        body.importBatchId,
        body.importBatchIds,
        'Provide importBatchId or importBatchIds, not both',
        'importBatchId or importBatchIds is required',
      ) ??
      validateNonEmptyArray(body.importBatchIds, 'importBatchIds must be a non-empty array') ??
      requireUniqueArray(body.importBatchIds, 'importBatchIds must contain unique elements') ??
      requireField(body.startDate, 'startDate') ??
      requireField(body.endDate, 'endDate') ??
      requireNonEmptyArray(body.sources, 'sources is required and must be a non-empty array') ??
      requireField(body.filterProfileId, 'filterProfileId') ??
      requireField(body.model, 'model')
    if (fail) return errors.invalidInput(fail)

    // If labelSpec is provided, both fields are required
    if (body.labelSpec && (!body.labelSpec.model || !body.labelSpec.promptVersionId)) {
      return errors.invalidInput('labelSpec must include both model and promptVersionId')
    }

    // Validate date format
    const dateFail =
      requireDateFormat(body.startDate!, 'startDate') ??
      requireDateFormat(body.endDate!, 'endDate')
    if (dateFail) return errors.invalidInput(dateFail)

    // Validate sources
    const validSources = ['chatgpt', 'claude', 'grok']
    for (const source of body.sources!) {
      if (!validSources.includes(source.toLowerCase())) {
        return errors.invalidInput(`Invalid source: ${source}`, { validSources })
      }
    }

    // Create the run
    const result = await createRun({
      ...(body.importBatchId ? { importBatchId: body.importBatchId } : {}),
      ...(body.importBatchIds ? { importBatchIds: body.importBatchIds } : {}),
      startDate: body.startDate!,
      endDate: body.endDate!,
      sources: body.sources!.map((s) => s.toLowerCase()),
      filterProfileId: body.filterProfileId!,
      model: body.model!,
      ...(body.labelSpec ? { labelSpec: body.labelSpec } : {}),
      maxInputTokens: body.maxInputTokens,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Create run error:', error)

    if (error instanceof UnknownModelPricingError) {
      return errorResponse(400, error.code, error.message, error.details)
    }

    if (error instanceof TimezoneMismatchError) {
      return errorResponse(400, error.code, error.message, {
        timezones: error.timezones,
        batchIds: error.batchIds,
      })
    }

    if (error instanceof NotFoundError) {
      return errors.notFound(error.resource)
    }
    if (error instanceof ServiceError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details)
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

    // Build query — use RunBatch membership (not deprecated Run.importBatchId)
    const where = importBatchId
      ? { runBatches: { some: { importBatchId } } }
      : {}

    const runs = await prisma.run.findMany({
      where,
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      orderBy: { createdAt: 'desc' },
      include: { runBatches: { select: { importBatchId: true } } },
    })

    const hasMore = runs.length > limit
    const items = hasMore ? runs.slice(0, limit) : runs
    const nextCursor = hasMore ? items[items.length - 1].id : undefined

    return NextResponse.json({
      items: items.map((run) => ({
        id: run.id,
        status: run.status.toLowerCase(),
        importBatchId: run.importBatchId,
        importBatchIds: run.runBatches.map((rb) => rb.importBatchId),
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
