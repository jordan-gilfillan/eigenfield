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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params

    const result = await resumeRun(runId)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return errors.notFound('Run')
      }
      if (error.message.includes('CANNOT_RESUME_CANCELLED')) {
        return errorResponse(400, 'CANNOT_RESUME_CANCELLED', 'Cancelled runs cannot be resumed')
      }
    }
    console.error('Resume run error:', error)
    return errors.internal()
  }
}
