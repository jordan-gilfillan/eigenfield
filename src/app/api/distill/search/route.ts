/**
 * GET /api/distill/search
 *
 * Full-text search over MessageAtoms (raw) and Outputs.
 *
 * Spec reference: 7.9, 10.1, 10.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { search, type SearchScope } from '@/lib/services/search'
import { errors } from '@/lib/api-utils'
import { SOURCE_VALUES, CATEGORY_VALUES } from '@/lib/enums'

const VALID_SCOPES: SearchScope[] = ['raw', 'outputs']

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const q = params.get('q')
    const scope = params.get('scope') as SearchScope | null
    const limitParam = params.get('limit')
    const cursor = params.get('cursor') ?? undefined
    const importBatchId = params.get('importBatchId') ?? undefined
    const runId = params.get('runId') ?? undefined
    const startDate = params.get('startDate') ?? undefined
    const endDate = params.get('endDate') ?? undefined
    const labelModel = params.get('labelModel') ?? undefined
    const labelPromptVersionId = params.get('labelPromptVersionId') ?? undefined
    const sourcesParam = params.get('sources') ?? undefined
    const categoriesParam = params.get('categories') ?? undefined

    // Validate required params
    if (!q || q.trim().length === 0) {
      return errors.invalidInput('q is required and must be non-empty')
    }

    if (!scope || !VALID_SCOPES.includes(scope)) {
      return errors.invalidInput('scope is required and must be "raw" or "outputs"', {
        validScopes: VALID_SCOPES,
      })
    }

    // Parse and clamp limit (spec 10.3: default 50, max 200)
    let limit = 50
    if (limitParam) {
      limit = parseInt(limitParam, 10)
      if (isNaN(limit) || limit < 1) {
        return errors.invalidInput('limit must be a positive integer')
      }
      if (limit > 200) {
        limit = 200
      }
    }

    // Validate date format if provided
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (startDate && !dateRegex.test(startDate)) {
      return errors.invalidInput('startDate must be in YYYY-MM-DD format')
    }
    if (endDate && !dateRegex.test(endDate)) {
      return errors.invalidInput('endDate must be in YYYY-MM-DD format')
    }

    // Parse and validate sources (comma-separated, lowercase)
    let sources: string[] | undefined
    if (sourcesParam) {
      sources = sourcesParam.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      const invalid = sources.filter((s) => !(SOURCE_VALUES as readonly string[]).includes(s))
      if (invalid.length > 0) {
        return errors.invalidInput(`Invalid source(s): ${invalid.join(', ')}`, {
          validSources: SOURCE_VALUES,
        })
      }
    }

    // Parse and validate categories (comma-separated, lowercase)
    let categories: string[] | undefined
    if (categoriesParam) {
      categories = categoriesParam.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
      const invalid = categories.filter((c) => !(CATEGORY_VALUES as readonly string[]).includes(c))
      if (invalid.length > 0) {
        return errors.invalidInput(`Invalid category(ies): ${invalid.join(', ')}`, {
          validCategories: CATEGORY_VALUES,
        })
      }
    }

    const result = await search({
      q: q.trim(),
      scope,
      limit,
      cursor,
      importBatchId,
      runId,
      startDate,
      endDate,
      sources,
      categories,
      labelModel,
      labelPromptVersionId,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Search error:', error)

    if (error instanceof Error && error.message === 'Invalid cursor') {
      return errors.invalidInput('Invalid cursor')
    }

    return errors.internal()
  }
}
