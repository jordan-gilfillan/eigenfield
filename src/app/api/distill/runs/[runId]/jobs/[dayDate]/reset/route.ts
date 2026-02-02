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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; dayDate: string }> }
) {
  try {
    const { runId, dayDate } = await params

    const result = await resetJob(runId, dayDate)

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Run not found')) {
        return errors.notFound('Run')
      }
      if (error.message.includes('Job not found')) {
        return errors.notFound('Job')
      }
      if (error.message.includes('CANNOT_RESET_CANCELLED')) {
        return errorResponse(400, 'CANNOT_RESET_CANCELLED', 'Cannot reset jobs in a cancelled run')
      }
    }
    console.error('Reset job error:', error)
    return errors.internal()
  }
}
