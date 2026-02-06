/**
 * GET /api/distill/import-batches/:id/days
 *
 * Returns available day dates (ASC) with coverage info for an ImportBatch.
 *
 * Spec reference: 10.2, PR-6.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { getImportBatch, getImportBatchDays } from '@/lib/services/import'
import { errors } from '@/lib/api-utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Verify batch exists
    const batch = await getImportBatch(id)
    if (!batch) {
      return errors.notFound('ImportBatch')
    }

    const days = await getImportBatchDays(id)

    return NextResponse.json({ importBatchId: id, days })
  } catch (error) {
    console.error('Get import batch days error:', error)
    return errors.internal()
  }
}
