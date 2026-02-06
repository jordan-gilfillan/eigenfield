/**
 * API utility functions
 *
 * Common helpers for API routes.
 */

import { NextResponse } from 'next/server'

/**
 * Standard error response per spec 7.8
 */
export interface ApiError {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

/**
 * Creates a standardized error response.
 */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): NextResponse<ApiError> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details && { details }),
      },
    },
    { status }
  )
}

/**
 * Common error responses
 */
export const errors = {
  invalidInput: (message: string, details?: Record<string, unknown>) =>
    errorResponse(400, 'INVALID_INPUT', message, details),

  notFound: (resource: string) =>
    errorResponse(404, 'NOT_FOUND', `${resource} not found`),

  unsupportedFormat: (message: string, details?: Record<string, unknown>) =>
    errorResponse(400, 'UNSUPPORTED_FORMAT', message, details),

  notImplemented: (message: string) =>
    errorResponse(501, 'NOT_IMPLEMENTED', message),

  internal: (message = 'An unexpected error occurred') =>
    errorResponse(500, 'INTERNAL', message),
}
