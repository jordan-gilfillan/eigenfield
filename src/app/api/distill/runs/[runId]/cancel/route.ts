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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params

    const result = await cancelRun(runId)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return errors.notFound('Run')
      }
      if (error.message.includes('ALREADY_COMPLETED')) {
        return errorResponse(400, 'ALREADY_COMPLETED', 'Cannot cancel a completed run')
      }
    }
    console.error('Cancel run error:', error)
    return errors.internal()
  }
}
