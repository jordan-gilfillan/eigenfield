/**
 * POST /api/distill/import
 *
 * Imports a conversation export file.
 *
 * Spec reference: 7.1, 7.9
 */

import { NextRequest, NextResponse } from 'next/server'
import { importExport } from '@/lib/services/import'
import { errors } from '@/lib/api-utils'
import type { SourceApi } from '@/lib/enums'
import { SOURCE_VALUES } from '@/lib/enums'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const sourceOverride = formData.get('sourceOverride') as string | null
    const timezone = formData.get('timezone') as string | null

    // Validate file
    if (!file) {
      return errors.invalidInput('No file provided')
    }

    // Validate sourceOverride if provided
    if (sourceOverride && !SOURCE_VALUES.includes(sourceOverride as SourceApi)) {
      return errors.invalidInput(`Invalid source: ${sourceOverride}`, {
        validSources: SOURCE_VALUES.filter((s) => s !== 'mixed'),
      })
    }

    // Read file content
    const content = await file.text()
    const fileSizeBytes = file.size
    const filename = file.name

    // Import the export
    const result = await importExport({
      content,
      filename,
      fileSizeBytes,
      sourceOverride: sourceOverride as SourceApi | undefined,
      timezone: timezone ?? undefined,
    })

    // Return response per spec 7.9
    return NextResponse.json(result)
  } catch (error) {
    console.error('Import error:', error)

    if (error instanceof Error) {
      // Parser not implemented for requested source
      if (error.message.includes('is not implemented')) {
        return errors.unsupportedFormat(error.message)
      }

      // Known errors from parsing or validation
      if (
        error.message.includes('Could not auto-detect') ||
        error.message.includes('No messages found') ||
        error.message.includes('must be an array')
      ) {
        return errors.invalidInput(error.message)
      }
    }

    return errors.internal()
  }
}
