/**
 * POST /api/distill/runs/:runId/tick
 *
 * Processes up to N queued jobs for a run.
 *
 * Spec reference: 7.4 (Process tick loop)
 */

import { NextRequest, NextResponse } from 'next/server'
import { processTick } from '@/lib/services/tick'
import { errors } from '@/lib/api-utils'

interface TickRequest {
  maxJobs?: number
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params
    const body = (await request.json().catch(() => ({}))) as Partial<TickRequest>

    // Validate maxJobs if provided
    let maxJobs = 1
    if (body.maxJobs !== undefined) {
      maxJobs = body.maxJobs
      if (!Number.isInteger(maxJobs) || maxJobs < 1) {
        return errors.invalidInput('maxJobs must be a positive integer')
      }
      if (maxJobs > 100) {
        maxJobs = 100 // Cap at 100 to prevent runaway processing
      }
    }

    // Process tick
    const result = await processTick({ runId, maxJobs })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Tick error:', error)

    if (error instanceof Error) {
      if (error.message.includes('Run not found')) {
        return errors.notFound('Run')
      }
      if ((error as Error & { code?: string }).code === 'TICK_IN_PROGRESS') {
        return NextResponse.json(
          {
            error: {
              code: 'TICK_IN_PROGRESS',
              message: 'Another tick is already processing this run',
            },
          },
          { status: 409 }
        )
      }
    }

    return errors.internal()
  }
}
