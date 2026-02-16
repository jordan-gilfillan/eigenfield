import { describe, it, expect } from 'vitest'
import {
  ServiceError,
  InvalidInputError,
  NotFoundError,
  NoEligibleDaysError,
  ConflictError,
} from '../lib/errors'

describe('ServiceError (base)', () => {
  it('sets code, httpStatus, message, and name', () => {
    const err = new ServiceError('something broke', {
      code: 'TEST_CODE',
      httpStatus: 418,
    })
    expect(err.message).toBe('something broke')
    expect(err.code).toBe('TEST_CODE')
    expect(err.httpStatus).toBe(418)
    expect(err.name).toBe('ServiceError')
    expect(err).toBeInstanceOf(Error)
  })

  it('accepts optional details', () => {
    const err = new ServiceError('with details', {
      code: 'X',
      httpStatus: 400,
      details: { foo: 'bar' },
    })
    expect(err.details).toEqual({ foo: 'bar' })
  })

  it('leaves details undefined when not provided', () => {
    const err = new ServiceError('no details', {
      code: 'X',
      httpStatus: 400,
    })
    expect(err.details).toBeUndefined()
  })
})

describe('InvalidInputError', () => {
  it('has code INVALID_INPUT and httpStatus 400', () => {
    const err = new InvalidInputError('bad param')
    expect(err.code).toBe('INVALID_INPUT')
    expect(err.httpStatus).toBe(400)
    expect(err.message).toBe('bad param')
    expect(err.name).toBe('InvalidInputError')
  })

  it('is instanceof ServiceError and Error', () => {
    const err = new InvalidInputError('x')
    expect(err).toBeInstanceOf(ServiceError)
    expect(err).toBeInstanceOf(Error)
  })

  it('accepts optional details', () => {
    const err = new InvalidInputError('x', { field: 'id' })
    expect(err.details).toEqual({ field: 'id' })
  })
})

describe('NotFoundError', () => {
  it('has code NOT_FOUND and httpStatus 404', () => {
    const err = new NotFoundError('Run')
    expect(err.code).toBe('NOT_FOUND')
    expect(err.httpStatus).toBe(404)
    expect(err.name).toBe('NotFoundError')
  })

  it('stores resource field', () => {
    const err = new NotFoundError('ImportBatch')
    expect(err.resource).toBe('ImportBatch')
  })

  it('formats message without id', () => {
    const err = new NotFoundError('Run')
    expect(err.message).toBe('Run not found')
  })

  it('formats message with id', () => {
    const err = new NotFoundError('ImportBatch', 'abc-123')
    expect(err.message).toBe('ImportBatch not found: abc-123')
    expect(err.resource).toBe('ImportBatch')
  })

  it('is instanceof ServiceError and Error', () => {
    const err = new NotFoundError('X')
    expect(err).toBeInstanceOf(ServiceError)
    expect(err).toBeInstanceOf(Error)
  })
})

describe('NoEligibleDaysError', () => {
  it('has code NO_ELIGIBLE_DAYS and httpStatus 400', () => {
    const err = new NoEligibleDaysError()
    expect(err.code).toBe('NO_ELIGIBLE_DAYS')
    expect(err.httpStatus).toBe(400)
    expect(err.name).toBe('NoEligibleDaysError')
  })

  it('uses default message', () => {
    const err = new NoEligibleDaysError()
    expect(err.message).toBe('No days match the filter criteria')
  })

  it('accepts custom message', () => {
    const err = new NoEligibleDaysError('custom')
    expect(err.message).toBe('custom')
  })

  it('is instanceof ServiceError and Error', () => {
    const err = new NoEligibleDaysError()
    expect(err).toBeInstanceOf(ServiceError)
    expect(err).toBeInstanceOf(Error)
  })
})

describe('ConflictError', () => {
  it('uses provided code and httpStatus 409', () => {
    const err = new ConflictError('ALREADY_COMPLETED', 'Cannot cancel a completed run')
    expect(err.code).toBe('ALREADY_COMPLETED')
    expect(err.httpStatus).toBe(409)
    expect(err.message).toBe('Cannot cancel a completed run')
    expect(err.name).toBe('ConflictError')
  })

  it('supports different conflict codes', () => {
    const err1 = new ConflictError('CANNOT_RESUME_CANCELLED', 'msg1')
    const err2 = new ConflictError('CANNOT_RESET_CANCELLED', 'msg2')
    expect(err1.code).toBe('CANNOT_RESUME_CANCELLED')
    expect(err2.code).toBe('CANNOT_RESET_CANCELLED')
  })

  it('is instanceof ServiceError and Error', () => {
    const err = new ConflictError('X', 'y')
    expect(err).toBeInstanceOf(ServiceError)
    expect(err).toBeInstanceOf(Error)
  })
})
