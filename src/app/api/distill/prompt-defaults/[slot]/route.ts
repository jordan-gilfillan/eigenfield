import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, errors } from '@/lib/api-utils'
import { ServiceError } from '@/lib/errors'
import { assignManagedPromptDefault } from '@/lib/services/prompt-management'
import { PROMPT_DEFAULT_SLOT_VALUES, type PromptDefaultSlotApi } from '@/lib/types/prompt-management'

interface AssignPromptDefaultRequest {
  promptVersionId?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slot: string }> },
) {
  try {
    const { slot: rawSlot } = await params
    const slot = rawSlot.toUpperCase() as PromptDefaultSlotApi
    if (!PROMPT_DEFAULT_SLOT_VALUES.includes(slot)) {
      return errors.invalidInput(`Invalid prompt default slot: ${rawSlot}`, {
        validSlots: PROMPT_DEFAULT_SLOT_VALUES,
      })
    }

    const body = (await request.json()) as AssignPromptDefaultRequest
    if (!body.promptVersionId) {
      return errors.invalidInput('promptVersionId is required')
    }

    const prompt = await assignManagedPromptDefault({
      slot,
      promptVersionId: body.promptVersionId,
    })

    return NextResponse.json(prompt)
  } catch (error) {
    console.error('Assign prompt default error:', error)
    if (error instanceof ServiceError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details)
    }
    return errors.internal()
  }
}
