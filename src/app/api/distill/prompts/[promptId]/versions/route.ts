import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, errors } from '@/lib/api-utils'
import { ServiceError } from '@/lib/errors'
import { createManagedPromptVersion } from '@/lib/services/prompt-management'

interface CreatePromptVersionRequest {
  versionLabel?: string
  templateText?: string
  activate?: boolean
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ promptId: string }> },
) {
  try {
    const { promptId } = await params
    const body = (await request.json()) as CreatePromptVersionRequest

    if (!body.versionLabel) {
      return errors.invalidInput('versionLabel is required')
    }
    if (!body.templateText) {
      return errors.invalidInput('templateText is required')
    }
    if (body.activate !== undefined && typeof body.activate !== 'boolean') {
      return errors.invalidInput('activate must be a boolean when provided')
    }

    const prompt = await createManagedPromptVersion({
      promptId,
      versionLabel: body.versionLabel,
      templateText: body.templateText,
      activate: body.activate,
    })

    return NextResponse.json(prompt, { status: 201 })
  } catch (error) {
    console.error('Create prompt version error:', error)
    if (error instanceof ServiceError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details)
    }
    return errors.internal()
  }
}
