import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, errors } from '@/lib/api-utils'
import { ServiceError } from '@/lib/errors'
import { activateManagedPromptVersion } from '@/lib/services/prompt-management'

interface ActivatePromptVersionRequest {
  promptVersionId?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ promptId: string }> },
) {
  try {
    const { promptId } = await params
    const body = (await request.json()) as ActivatePromptVersionRequest

    if (!body.promptVersionId) {
      return errors.invalidInput('promptVersionId is required')
    }

    const prompt = await activateManagedPromptVersion({
      promptId,
      promptVersionId: body.promptVersionId,
    })

    return NextResponse.json(prompt)
  } catch (error) {
    console.error('Activate prompt version error:', error)
    if (error instanceof ServiceError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details)
    }
    return errors.internal()
  }
}
