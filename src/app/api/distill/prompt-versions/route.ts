/**
 * GET /api/distill/prompt-versions
 *
 * Returns prompt versions, optionally filtered by stage and active status.
 *
 * Query params:
 * - stage: 'classify' | 'summarize' | 'redact' (optional)
 * - active: 'true' to get only active version (optional)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { errors } from '@/lib/api-utils'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const stage = searchParams.get('stage')?.toUpperCase()
    const activeOnly = searchParams.get('active') === 'true'

    // Validate stage if provided
    const validStages = ['CLASSIFY', 'SUMMARIZE', 'REDACT']
    if (stage && !validStages.includes(stage)) {
      return errors.invalidInput(`Invalid stage: ${stage}`, { validStages })
    }

    // Build query
    if (activeOnly && stage) {
      // Get single active version for a stage
      const promptVersion = await prisma.promptVersion.findFirst({
        where: {
          isActive: true,
          prompt: {
            stage: stage as 'CLASSIFY' | 'SUMMARIZE' | 'REDACT',
          },
        },
        include: {
          prompt: {
            select: { stage: true, name: true },
          },
        },
      })

      return NextResponse.json({ promptVersion })
    }

    // Get list of versions
    const promptVersions = await prisma.promptVersion.findMany({
      where: {
        ...(stage && {
          prompt: {
            stage: stage as 'CLASSIFY' | 'SUMMARIZE' | 'REDACT',
          },
        }),
        ...(activeOnly && { isActive: true }),
      },
      include: {
        prompt: {
          select: { stage: true, name: true },
        },
      },
      orderBy: [{ prompt: { stage: 'asc' } }, { createdAt: 'desc' }],
    })

    return NextResponse.json({ promptVersions })
  } catch (error) {
    console.error('Prompt versions error:', error)
    return errors.internal()
  }
}
