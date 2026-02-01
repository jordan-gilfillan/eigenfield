/**
 * Core library exports
 */

// Normalization
export { normalizeText } from './normalize'

// Timestamps
export {
  toCanonicalTimestamp,
  parseToCanonicalTimestamp,
  extractDayDate,
} from './timestamp'

// Hashing
export { sha256, hashToUint32 } from './hash'

// Stable IDs
export {
  computeAtomStableId,
  computeTextHash,
  type AtomStableIdParams,
} from './stableId'

// Bundle hashes
export {
  computeBundleHash,
  computeBundleContextHash,
  type BundleContextParams,
} from './bundleHash'

// RawEntry
export {
  buildRawEntryContent,
  computeRawEntryHash,
  type RawEntryAtom,
} from './rawEntry'

// Enum serialization
export {
  // Source
  SOURCE_VALUES,
  sourceToApi,
  sourceToDb,
  type SourceApi,
  type SourceDb,
  // Role
  ROLE_VALUES,
  roleToApi,
  roleToDb,
  type RoleApi,
  type RoleDb,
  // Category
  CATEGORY_VALUES,
  CORE_CATEGORY_VALUES,
  categoryToApi,
  categoryToDb,
  type CategoryApi,
  type CategoryDb,
  type CoreCategoryApi,
  // FilterMode
  FILTER_MODE_VALUES,
  filterModeToApi,
  filterModeToDb,
  type FilterModeApi,
  type FilterModeDb,
  // RunStatus
  RUN_STATUS_VALUES,
  runStatusToApi,
  runStatusToDb,
  type RunStatusApi,
  type RunStatusDb,
  // JobStatus
  JOB_STATUS_VALUES,
  jobStatusToApi,
  jobStatusToDb,
  type JobStatusApi,
  type JobStatusDb,
  // Stage
  STAGE_VALUES,
  stageToApi,
  stageToDb,
  type StageApi,
  type StageDb,
} from './enums'
