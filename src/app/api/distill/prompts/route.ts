import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, errors } from '@/lib/api-utils'
import { ServiceError } from '@/lib/errors'
import { listManagedPromptFamilies } from '@/lib/services/prompt-management'

export async function GET(request: NextRequest) {
  try {
    const stage = request.nextUrl.searchParams.get('stage')?.toUpperCase()
    const validStages = ['CLASSIFY', 'SUMMARIZE', 'REDACT'] as const

    if (stage && !validStages.includes(stage as (typeof validStages)[number])) {
      return errors.invalidInput(`Invalid stage: ${stage}`, { validStages })
    }

    const items = await listManagedPromptFamilies(
      stage as 'CLASSIFY' | 'SUMMARIZE' | 'REDACT' | undefined,
    )

    return NextResponse.json({ items })
  } catch (error) {
    console.error('Prompt list error:', error)
    if (error instanceof ServiceError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details)
    }
    return errors.internal()
  }
}
