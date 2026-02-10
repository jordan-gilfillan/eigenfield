/**
 * POST /api/distill/import
 *
 * Imports a conversation export file.
 *
 * Spec reference: 7.1, 7.9
 *
 * PR-7.3: Auto-detection returns structured errors:
 * - UNSUPPORTED_FORMAT if 0 parsers match
 * - AMBIGUOUS_FORMAT if >1 parsers match (with matched parser ids)
 */

import { NextRequest, NextResponse } from 'next/server'
import { importExport } from '@/lib/services/import'
import { errors } from '@/lib/api-utils'
import { UnsupportedFormatError, AmbiguousFormatError } from '@/lib/parsers'
import type { SourceApi } from '@/lib/enums'
import { SOURCE_VALUES } from '@/lib/enums'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const sourceOverride = formData.get('sourceOverride') as string | null
    const timezone = formData.get('timezone') as string | null

    // Validate sourceOverride if provided (before file check so bad source is rejected early)
    if (sourceOverride) {
      if (sourceOverride === 'mixed') {
        return errors.invalidInput(
          'sourceOverride=mixed is reserved; v0.3 supports single-source imports only',
          { validSources: SOURCE_VALUES.filter((s) => s !== 'mixed') },
        )
      }
      if (!SOURCE_VALUES.includes(sourceOverride as SourceApi)) {
        return errors.invalidInput(`Invalid source: ${sourceOverride}`, {
          validSources: SOURCE_VALUES.filter((s) => s !== 'mixed'),
        })
      }
    }

    // Validate file
    if (!file) {
      return errors.invalidInput('No file provided')
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

    // Auto-detection: no parser matched
    if (error instanceof UnsupportedFormatError) {
      return errors.unsupportedFormat(error.message)
    }

    // Auto-detection: multiple parsers matched
    if (error instanceof AmbiguousFormatError) {
      return errors.ambiguousFormat(error.message, {
        matched: error.matched,
      })
    }

    if (error instanceof Error) {
      // Parser not implemented for requested source
      if (error.message.includes('is not implemented')) {
        return errors.unsupportedFormat(error.message)
      }

      // Known errors from parsing or validation
      if (
        error.message.includes('No messages found') ||
        error.message.includes('must be an array')
      ) {
        return errors.invalidInput(error.message)
      }
    }

    return errors.internal()
  }
}
