/**
 * GET /api/distill/import-batches
 *
 * Lists all import batches with pagination.
 *
 * Spec reference: 10.3 (Pagination)
 */

import { NextRequest, NextResponse } from 'next/server'
import { listImportBatches } from '@/lib/services/import'
import { errors } from '@/lib/api-utils'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const limitParam = searchParams.get('limit')
    const cursor = searchParams.get('cursor')

    // Parse limit with validation per spec 10.3
    let limit = 50 // default
    if (limitParam) {
      limit = parseInt(limitParam, 10)
      if (isNaN(limit) || limit < 1) {
        return errors.invalidInput('limit must be a positive integer')
      }
      if (limit > 200) {
        limit = 200 // max per spec
      }
    }

    const result = await listImportBatches({
      limit,
      cursor: cursor ?? undefined,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('List import batches error:', error)
    return errors.internal()
  }
}
