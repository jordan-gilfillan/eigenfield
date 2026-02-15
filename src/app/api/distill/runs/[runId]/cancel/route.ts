/**
 * POST /api/distill/runs/:runId/cancel
 *
 * Cancels a run and all its queued jobs.
 *
 * Spec reference: 7.6 (Resume / Cancel)
 */

import { NextRequest, NextResponse } from 'next/server'
import { cancelRun } from '@/lib/services/run'
import { errors, errorResponse } from '@/lib/api-utils'
import { NotFoundError, ServiceError } from '@/lib/errors'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params

    const result = await cancelRun(runId)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof NotFoundError) {
      return errors.notFound(error.resource)
    }
    if (error instanceof ServiceError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details)
    }
    console.error('Cancel run error:', error)
    return errors.internal()
  }
}
