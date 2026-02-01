/**
 * GET /api/distill/import-batches/:id
 *
 * Gets a single import batch by ID.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getImportBatch } from '@/lib/services/import'
import { errors } from '@/lib/api-utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const batch = await getImportBatch(id)

    if (!batch) {
      return errors.notFound('ImportBatch')
    }

    return NextResponse.json({ importBatch: batch })
  } catch (error) {
    console.error('Get import batch error:', error)
    return errors.internal()
  }
}
