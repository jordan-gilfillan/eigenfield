/**
 * Shared typed service errors for route-level instanceof dispatch.
 *
 * Each subclass carries a fixed `code` and `httpStatus` so route handlers
 * can replace fragile message.includes() checks with instanceof.
 */

export class ServiceError extends Error {
  readonly code: string
  readonly httpStatus: number
  readonly details?: Record<string, unknown>

  constructor(
    message: string,
    opts: { code: string; httpStatus: number; details?: Record<string, unknown> }
  ) {
    super(message)
    this.name = this.constructor.name
    this.code = opts.code
    this.httpStatus = opts.httpStatus
    this.details = opts.details
  }
}

export class InvalidInputError extends ServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { code: 'INVALID_INPUT', httpStatus: 400, details })
  }
}

export class NotFoundError extends ServiceError {
  readonly resource: string

  constructor(resource: string, id?: string) {
    super(id ? `${resource} not found: ${id}` : `${resource} not found`, {
      code: 'NOT_FOUND',
      httpStatus: 404,
    })
    this.resource = resource
  }
}

export class NoEligibleDaysError extends ServiceError {
  constructor(message = 'No days match the filter criteria') {
    super(message, { code: 'NO_ELIGIBLE_DAYS', httpStatus: 400 })
  }
}

export class ConflictError extends ServiceError {
  constructor(code: string, message: string) {
    super(message, { code, httpStatus: 409 })
  }
}

export class TickInProgressError extends ServiceError {
  constructor(message = 'Tick already in progress') {
    super(message, { code: 'TICK_IN_PROGRESS', httpStatus: 409 })
  }
}
