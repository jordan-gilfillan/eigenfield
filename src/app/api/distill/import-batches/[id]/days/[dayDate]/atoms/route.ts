/**
 * GET /api/distill/import-batches/:id/days/:dayDate/atoms
 *
 * Returns atoms for a specific day in deterministic order.
 * Optional query param: source (lowercase, e.g. "chatgpt")
 *
 * Spec reference: 10.2, 6.5 ordering, PR-6.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { getImportBatch, getImportBatchDayAtoms } from '@/lib/services/import'
import { errors } from '@/lib/api-utils'
import { SOURCE_VALUES } from '@/lib/enums'

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dayDate: string }> }
) {
  try {
    const { id, dayDate } = await params

    // Validate dayDate format
    if (!DATE_REGEX.test(dayDate)) {
      return errors.invalidInput('dayDate must be in YYYY-MM-DD format')
    }

    // Validate source if provided
    const source = request.nextUrl.searchParams.get('source') ?? undefined
    if (source && !SOURCE_VALUES.includes(source as typeof SOURCE_VALUES[number])) {
      return errors.invalidInput(`Invalid source: ${source}`, {
        validSources: [...SOURCE_VALUES],
      })
    }

    // Verify batch exists
    const batch = await getImportBatch(id)
    if (!batch) {
      return errors.notFound('ImportBatch')
    }

    const atoms = await getImportBatchDayAtoms({
      importBatchId: id,
      dayDate,
      source,
    })

    return NextResponse.json({
      importBatchId: id,
      dayDate,
      source: source ?? null,
      atoms,
    })
  } catch (error) {
    console.error('Get import batch day atoms error:', error)
    return errors.internal()
  }
}
