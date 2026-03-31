/**
 * POST /api/distill/classify-runs/:id/stop
 *
 * Requests that a running classify operation stop after the current atom.
 * This is foreground-only and does not introduce background retry/resume work.
 */

import { NextRequest, NextResponse } from 'next/server'
import { errors, errorResponse } from '@/lib/api-utils'
import { NotFoundError, ServiceError } from '@/lib/errors'
import { requestClassifyStop } from '@/lib/services/classify'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const result = await requestClassifyStop(id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof NotFoundError) {
      return errors.notFound(error.resource)
    }
    if (error instanceof ServiceError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details)
    }
    console.error('Stop classify error:', error)
    return errors.internal()
  }
}
