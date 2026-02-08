import { describe, it, expect } from 'vitest'
import {
  sourceToApi,
  sourceToDb,
  roleToApi,
  roleToDb,
  categoryToApi,
  categoryToDb,
  filterModeToApi,
  filterModeToDb,
  runStatusToApi,
  runStatusToDb,
  jobStatusToApi,
  jobStatusToDb,
  stageToApi,
  stageToDb,
  CLASSIFY_RUN_STATUS_VALUES,
  isClassifyRunStatus,
} from '../lib/enums'

describe('Source enum conversion', () => {
  it('converts DB to API format', () => {
    expect(sourceToApi('CHATGPT')).toBe('chatgpt')
    expect(sourceToApi('CLAUDE')).toBe('claude')
    expect(sourceToApi('GROK')).toBe('grok')
    expect(sourceToApi('MIXED')).toBe('mixed')
  })

  it('converts API to DB format', () => {
    expect(sourceToDb('chatgpt')).toBe('CHATGPT')
    expect(sourceToDb('claude')).toBe('CLAUDE')
    expect(sourceToDb('grok')).toBe('GROK')
    expect(sourceToDb('mixed')).toBe('MIXED')
  })

  it('round-trips correctly', () => {
    expect(sourceToDb(sourceToApi('CHATGPT'))).toBe('CHATGPT')
    expect(sourceToApi(sourceToDb('chatgpt'))).toBe('chatgpt')
  })
})

describe('Role enum conversion', () => {
  it('converts DB to API format', () => {
    expect(roleToApi('USER')).toBe('user')
    expect(roleToApi('ASSISTANT')).toBe('assistant')
  })

  it('converts API to DB format', () => {
    expect(roleToDb('user')).toBe('USER')
    expect(roleToDb('assistant')).toBe('ASSISTANT')
  })
})

describe('Category enum conversion', () => {
  it('converts core categories', () => {
    expect(categoryToApi('WORK')).toBe('work')
    expect(categoryToApi('LEARNING')).toBe('learning')
    expect(categoryToApi('CREATIVE')).toBe('creative')
    expect(categoryToApi('MUNDANE')).toBe('mundane')
    expect(categoryToApi('PERSONAL')).toBe('personal')
    expect(categoryToApi('OTHER')).toBe('other')
  })

  it('converts risk bucket categories', () => {
    expect(categoryToApi('MEDICAL')).toBe('medical')
    expect(categoryToApi('MENTAL_HEALTH')).toBe('mental_health')
    expect(categoryToApi('ADDICTION_RECOVERY')).toBe('addiction_recovery')
    expect(categoryToApi('INTIMACY')).toBe('intimacy')
    expect(categoryToApi('FINANCIAL')).toBe('financial')
    expect(categoryToApi('LEGAL')).toBe('legal')
  })

  it('converts additional category', () => {
    expect(categoryToApi('EMBARRASSING')).toBe('embarrassing')
  })

  it('converts API to DB format', () => {
    expect(categoryToDb('work')).toBe('WORK')
    expect(categoryToDb('mental_health')).toBe('MENTAL_HEALTH')
  })
})

describe('FilterMode enum conversion', () => {
  it('converts both directions', () => {
    expect(filterModeToApi('INCLUDE')).toBe('include')
    expect(filterModeToApi('EXCLUDE')).toBe('exclude')
    expect(filterModeToDb('include')).toBe('INCLUDE')
    expect(filterModeToDb('exclude')).toBe('EXCLUDE')
  })
})

describe('RunStatus enum conversion', () => {
  it('converts all statuses', () => {
    expect(runStatusToApi('QUEUED')).toBe('queued')
    expect(runStatusToApi('RUNNING')).toBe('running')
    expect(runStatusToApi('COMPLETED')).toBe('completed')
    expect(runStatusToApi('CANCELLED')).toBe('cancelled')
    expect(runStatusToApi('FAILED')).toBe('failed')
  })

  it('converts API to DB format', () => {
    expect(runStatusToDb('queued')).toBe('QUEUED')
    expect(runStatusToDb('cancelled')).toBe('CANCELLED')
  })
})

describe('JobStatus enum conversion', () => {
  it('converts all statuses', () => {
    expect(jobStatusToApi('QUEUED')).toBe('queued')
    expect(jobStatusToApi('RUNNING')).toBe('running')
    expect(jobStatusToApi('SUCCEEDED')).toBe('succeeded')
    expect(jobStatusToApi('FAILED')).toBe('failed')
    expect(jobStatusToApi('CANCELLED')).toBe('cancelled')
  })
})

describe('Stage enum conversion', () => {
  it('converts all stages', () => {
    expect(stageToApi('CLASSIFY')).toBe('classify')
    expect(stageToApi('SUMMARIZE')).toBe('summarize')
    expect(stageToApi('REDACT')).toBe('redact')
  })

  it('converts API to DB format', () => {
    expect(stageToDb('classify')).toBe('CLASSIFY')
    expect(stageToDb('summarize')).toBe('SUMMARIZE')
  })
})

describe('ClassifyRunStatus', () => {
  it('has exactly three valid values: running, succeeded, failed', () => {
    expect(CLASSIFY_RUN_STATUS_VALUES).toEqual(['running', 'succeeded', 'failed'])
  })

  it('does not include cancelled', () => {
    expect(CLASSIFY_RUN_STATUS_VALUES).not.toContain('cancelled')
  })

  it('isClassifyRunStatus accepts valid values', () => {
    expect(isClassifyRunStatus('running')).toBe(true)
    expect(isClassifyRunStatus('succeeded')).toBe(true)
    expect(isClassifyRunStatus('failed')).toBe(true)
  })

  it('isClassifyRunStatus rejects invalid values', () => {
    expect(isClassifyRunStatus('cancelled')).toBe(false)
    expect(isClassifyRunStatus('queued')).toBe(false)
    expect(isClassifyRunStatus('RUNNING')).toBe(false)
    expect(isClassifyRunStatus('')).toBe(false)
  })
})
