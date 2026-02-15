/**
 * POST /api/distill/runs/:runId/jobs/:dayDate/reset
 *
 * Resets a specific job for reprocessing.
 *
 * Spec reference: 7.7 (Reset / Reprocess)
 */

import { NextRequest, NextResponse } from 'next/server'
import { resetJob } from '@/lib/services/run'
import { errors, errorResponse } from '@/lib/api-utils'
import { NotFoundError, ServiceError } from '@/lib/errors'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; dayDate: string }> }
) {
  try {
    const { runId, dayDate } = await params

    const result = await resetJob(runId, dayDate)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof NotFoundError) {
      return errors.notFound(error.resource)
    }
    if (error instanceof ServiceError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details)
    }
    console.error('Reset job error:', error)
    return errors.internal()
  }
}
