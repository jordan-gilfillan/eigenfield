/**
 * POST /api/distill/runs/:runId/resume
 *
 * Resumes a failed run by requeuing failed jobs.
 *
 * Spec reference: 7.6 (Resume / Cancel)
 */

import { NextRequest, NextResponse } from 'next/server'
import { resumeRun } from '@/lib/services/run'
import { errors, errorResponse } from '@/lib/api-utils'
import { NotFoundError, ServiceError } from '@/lib/errors'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params

    const result = await resumeRun(runId)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof NotFoundError) {
      return errors.notFound(error.resource)
    }
    if (error instanceof ServiceError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details)
    }
    console.error('Resume run error:', error)
    return errors.internal()
  }
}
