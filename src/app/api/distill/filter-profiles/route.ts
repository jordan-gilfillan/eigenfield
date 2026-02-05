/**
 * GET /api/distill/filter-profiles
 *
 * Lists all available filter profiles.
 *
 * Spec reference: 6.6
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { errors } from '@/lib/api-utils'

export async function GET() {
  try {
    const profiles = await prisma.filterProfile.findMany({
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      items: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        mode: p.mode.toLowerCase(),
        categories: p.categories,
      })),
    })
  } catch (error) {
    console.error('List filter profiles error:', error)
    return errors.internal()
  }
}
