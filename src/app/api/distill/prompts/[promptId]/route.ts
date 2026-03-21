import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, errors } from '@/lib/api-utils'
import { ServiceError } from '@/lib/errors'
import { getManagedPromptFamily } from '@/lib/services/prompt-management'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ promptId: string }> },
) {
  try {
    const { promptId } = await params
    const prompt = await getManagedPromptFamily(promptId)
    return NextResponse.json(prompt)
  } catch (error) {
    console.error('Prompt detail error:', error)
    if (error instanceof ServiceError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details)
    }
    return errors.internal()
  }
}
