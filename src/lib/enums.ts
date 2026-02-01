/**
 * Enum serialization helpers
 *
 * Prisma uses uppercase enums (e.g., CHATGPT, USER, WORK)
 * API returns lowercase strings (e.g., "chatgpt", "user", "work")
 *
 * These helpers convert between the two representations.
 */

// =============================================================================
// Source enum
// =============================================================================

export const SOURCE_VALUES = ['chatgpt', 'claude', 'grok', 'mixed'] as const
export type SourceApi = (typeof SOURCE_VALUES)[number]
export type SourceDb = 'CHATGPT' | 'CLAUDE' | 'GROK' | 'MIXED'

export function sourceToApi(db: SourceDb): SourceApi {
  return db.toLowerCase() as SourceApi
}

export function sourceToDb(api: SourceApi): SourceDb {
  return api.toUpperCase() as SourceDb
}

// =============================================================================
// Role enum
// =============================================================================

export const ROLE_VALUES = ['user', 'assistant'] as const
export type RoleApi = (typeof ROLE_VALUES)[number]
export type RoleDb = 'USER' | 'ASSISTANT'

export function roleToApi(db: RoleDb): RoleApi {
  return db.toLowerCase() as RoleApi
}

export function roleToDb(api: RoleApi): RoleDb {
  return api.toUpperCase() as RoleDb
}

// =============================================================================
// Category enum
// =============================================================================

export const CATEGORY_VALUES = [
  // Core
  'work',
  'learning',
  'creative',
  'mundane',
  'personal',
  'other',
  // Risk buckets
  'medical',
  'mental_health',
  'addiction_recovery',
  'intimacy',
  'financial',
  'legal',
  // Additional
  'embarrassing',
] as const
export type CategoryApi = (typeof CATEGORY_VALUES)[number]
export type CategoryDb =
  | 'WORK'
  | 'LEARNING'
  | 'CREATIVE'
  | 'MUNDANE'
  | 'PERSONAL'
  | 'OTHER'
  | 'MEDICAL'
  | 'MENTAL_HEALTH'
  | 'ADDICTION_RECOVERY'
  | 'INTIMACY'
  | 'FINANCIAL'
  | 'LEGAL'
  | 'EMBARRASSING'

// Core categories only (for stub classification)
export const CORE_CATEGORY_VALUES = [
  'work',
  'learning',
  'creative',
  'mundane',
  'personal',
  'other',
] as const
export type CoreCategoryApi = (typeof CORE_CATEGORY_VALUES)[number]

export function categoryToApi(db: CategoryDb): CategoryApi {
  return db.toLowerCase() as CategoryApi
}

export function categoryToDb(api: CategoryApi): CategoryDb {
  return api.toUpperCase() as CategoryDb
}

// =============================================================================
// FilterMode enum
// =============================================================================

export const FILTER_MODE_VALUES = ['include', 'exclude'] as const
export type FilterModeApi = (typeof FILTER_MODE_VALUES)[number]
export type FilterModeDb = 'INCLUDE' | 'EXCLUDE'

export function filterModeToApi(db: FilterModeDb): FilterModeApi {
  return db.toLowerCase() as FilterModeApi
}

export function filterModeToDb(api: FilterModeApi): FilterModeDb {
  return api.toUpperCase() as FilterModeDb
}

// =============================================================================
// RunStatus enum
// =============================================================================

export const RUN_STATUS_VALUES = [
  'queued',
  'running',
  'completed',
  'cancelled',
  'failed',
] as const
export type RunStatusApi = (typeof RUN_STATUS_VALUES)[number]
export type RunStatusDb = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED'

export function runStatusToApi(db: RunStatusDb): RunStatusApi {
  return db.toLowerCase() as RunStatusApi
}

export function runStatusToDb(api: RunStatusApi): RunStatusDb {
  return api.toUpperCase() as RunStatusDb
}

// =============================================================================
// JobStatus enum
// =============================================================================

export const JOB_STATUS_VALUES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const
export type JobStatusApi = (typeof JOB_STATUS_VALUES)[number]
export type JobStatusDb = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'

export function jobStatusToApi(db: JobStatusDb): JobStatusApi {
  return db.toLowerCase() as JobStatusApi
}

export function jobStatusToDb(api: JobStatusApi): JobStatusDb {
  return api.toUpperCase() as JobStatusDb
}

// =============================================================================
// Stage enum
// =============================================================================

export const STAGE_VALUES = ['classify', 'summarize', 'redact'] as const
export type StageApi = (typeof STAGE_VALUES)[number]
export type StageDb = 'CLASSIFY' | 'SUMMARIZE' | 'REDACT'

export function stageToApi(db: StageDb): StageApi {
  return db.toLowerCase() as StageApi
}

export function stageToDb(api: StageApi): StageDb {
  return api.toUpperCase() as StageDb
}
