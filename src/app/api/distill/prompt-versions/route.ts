/**
 * GET /api/distill/prompt-versions
 *
 * Returns prompt versions, optionally filtered by stage, active status, or versionLabel.
 *
 * Query params:
 * - stage: 'classify' | 'summarize' | 'redact' (optional)
 * - active: 'true' to filter to active versions (optional)
 * - versionLabel: exact match on versionLabel (optional)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { errorResponse, errors } from '@/lib/api-utils'
import { ServiceError } from '@/lib/errors'
import {
  classifyModeToPromptDefaultSlot,
  resolveDefaultClassifyPromptVersion,
} from '@/lib/services/prompt-version-defaults'
import { getPromptCompatibilityMap } from '@/lib/prompt-metadata'

function serializePromptVersion(
  promptVersion: {
    id: string
    promptId: string
    versionLabel: string
    templateText: string
    createdAt: Date
    isActive: boolean
    prompt: { id: string; stage: 'CLASSIFY' | 'SUMMARIZE' | 'REDACT'; name: string }
    defaultAssignments?: Array<{ slot: 'CLASSIFY_STUB' | 'CLASSIFY_REAL' | 'SUMMARIZE' | 'REDACT' }>
  },
  forcedDefaultSlots?: Array<'CLASSIFY_STUB' | 'CLASSIFY_REAL' | 'SUMMARIZE' | 'REDACT'>,
  includeTemplateText = false,
) {
  return {
    id: promptVersion.id,
    versionLabel: promptVersion.versionLabel,
    createdAt: promptVersion.createdAt.toISOString(),
    isActive: promptVersion.isActive,
    prompt: promptVersion.prompt,
    defaultSlots: forcedDefaultSlots ?? (promptVersion.defaultAssignments ?? []).map((item) => item.slot),
    compatibility: getPromptCompatibilityMap(promptVersion),
    ...(includeTemplateText ? { templateText: promptVersion.templateText } : {}),
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const stage = searchParams.get('stage')?.toUpperCase()
    const activeOnly = searchParams.get('active') === 'true'
    const defaultOnly = searchParams.get('default') === 'true'
    const versionLabel = searchParams.get('versionLabel')
    const mode = searchParams.get('mode')

    // Validate stage if provided
    const validStages = ['CLASSIFY', 'SUMMARIZE', 'REDACT']
    if (stage && !validStages.includes(stage)) {
      return errors.invalidInput(`Invalid stage: ${stage}`, { validStages })
    }

    if (defaultOnly) {
      if (stage !== 'CLASSIFY') {
        return errors.invalidInput('default=true currently requires stage=classify')
      }
      if (mode !== 'stub' && mode !== 'real') {
        return errors.invalidInput('mode must be "stub" or "real" when default=true and stage=classify')
      }

      const promptVersion = await resolveDefaultClassifyPromptVersion(mode)
      return NextResponse.json({
        promptVersion: serializePromptVersion(
          promptVersion,
          [classifyModeToPromptDefaultSlot(mode)],
          true,
        ),
      })
    }

    // Query by versionLabel: returns single promptVersion (like active+stage)
    if (versionLabel) {
      const promptVersion = await prisma.promptVersion.findFirst({
        where: {
          versionLabel,
          ...(stage && {
            prompt: {
              stage: stage as 'CLASSIFY' | 'SUMMARIZE' | 'REDACT',
            },
          }),
        },
        include: {
          prompt: {
            select: { id: true, stage: true, name: true },
          },
          defaultAssignments: {
            select: { slot: true },
          },
        },
      })

      return NextResponse.json({
        promptVersion: promptVersion ? serializePromptVersion(promptVersion, undefined, true) : null,
      })
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
          select: { id: true, stage: true, name: true },
        },
        defaultAssignments: {
          select: { slot: true },
        },
      },
      orderBy: [{ prompt: { stage: 'asc' } }, { prompt: { name: 'asc' } }, { createdAt: 'desc' }],
    })

    return NextResponse.json({
      promptVersions: promptVersions.map((promptVersion) => serializePromptVersion(promptVersion)),
    })
  } catch (error) {
    console.error('Prompt versions error:', error)
    if (error instanceof ServiceError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details)
    }
    return errors.internal()
  }
}
