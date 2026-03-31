'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { BadOutputReasonKey, ClassifyWarningDetails } from '@/lib/classify-warning-details'
import { ClassifyPromptPicker } from '@/components/prompts/ClassifyPromptPicker'
import type { ManagedPromptVersion } from '@/lib/types/prompt-management'
import {
  getImportBatchSources,
  isDuplicateImportResult,
  isReusableImportBatch,
  toDemoImportBatch,
  type DemoImportBatch,
  type DemoImportResult,
} from './import-batch-utils'
import { usePolling } from '../distill/hooks/usePolling'
import { startAutoRunLoop } from '../distill/hooks/useAutoRun'
import {
  formatProgressPercent,
  getClassifyStatusColor,
  getStatusColor,
} from '../distill/lib/ui-utils'

type ProviderId = 'openai' | 'anthropic'
type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'
type ClassifyMode = 'stub' | 'real'
type SummarizeMode = 'stub' | 'real'
type StepState = 'locked' | 'ready' | 'working' | 'done'
type ImportEntryMode = 'upload' | 'existing'

const PROVIDER_MODELS: Record<ProviderId, { label: string; models: string[] }> = {
  openai: {
    label: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
  },
  anthropic: {
    label: 'Anthropic',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-5-sonnet'],
  },
}

const TERMINAL_RUN_STATUSES = new Set(['completed', 'cancelled', 'failed'])
const TERMINAL_CLASSIFY_STATUSES = new Set(['succeeded', 'failed'])
const CLASSIFY_POLL_INTERVAL_MS = 800
const USER_STOPPED_CODE = 'USER_STOPPED'
const BAD_OUTPUT_REASON_LABELS: Record<BadOutputReasonKey, string> = {
  invalid_json: 'Invalid JSON',
  non_object: 'Non-object JSON',
  bad_category_field: 'Bad category field',
  invalid_category_value: 'Invalid category value',
  bad_confidence_field: 'Bad confidence field',
  confidence_out_of_range: 'Confidence out of range',
}

type PromptVersion = ManagedPromptVersion

interface ClassifyResult {
  classifyRunId: string
  importBatchId: string
  labelSpec: { model: string; promptVersionId: string }
  mode: ClassifyMode
  totals: {
    messageAtoms: number
    labeled: number
    newlyLabeled: number
    skippedAlreadyLabeled: number
  }
}

interface ClassifyRunStatus {
  id: string
  importBatchId: string
  labelSpec: {
    model: string
    promptVersionId: string
    promptVersionLabel: string
    promptName: string
  }
  mode: ClassifyMode
  status: 'running' | 'succeeded' | 'failed'
  totals: {
    messageAtoms: number
    labeled: number
    newlyLabeled: number
    skippedAlreadyLabeled: number
  }
  progress: {
    processedAtoms: number
    totalAtoms: number
  }
  usage: {
    tokensIn: number | null
    tokensOut: number | null
    costUsd: number | null
  }
  warnings: {
    skippedBadOutput: number
    aliasedCount: number
    details?: ClassifyWarningDetails
  }
  checkpoint: {
    lastAtomStableIdProcessed: string | null
  }
  control: {
    canStop: boolean
    stopRequested: boolean
  }
  lastError: {
    code: string
    message: string
  } | null
  createdAt: string
  updatedAt: string
  startedAt: string
  finishedAt: string | null
}

interface FilterProfile {
  id: string
  name: string
  mode: string
  categories: string[]
}

interface RunDetail {
  id: string
  status: string
  importBatchId: string
  importBatchIds?: string[]
  model: string
  sources: string[]
  startDate: string
  endDate: string
  config: {
    promptVersionIds: { summarize: string }
    labelSpec: { model: string; promptVersionId: string }
    filterProfile: { name: string; mode: string; categories: string[] }
    timezone: string
    maxInputTokens: number
    budgetPolicy?: { maxUsdPerRun: number; maxUsdPerDay: number }
  }
  progress: {
    queued: number
    running: number
    succeeded: number
    failed: number
    cancelled: number
  }
  totals: {
    jobs: number
    tokensIn: number
    tokensOut: number
    costUsd: number
  }
  jobs: Array<{
    dayDate: string
    status: string
    attempt: number
    tokensIn: number
    tokensOut: number
    costUsd: number
    error: string | null
  }>
  createdAt: string
}

interface OutputResponse {
  runId: string
  dayDate: string
  jobStatus: string
  hasOutput: boolean
  output: {
    id: string
    stage: string
    outputText: string
    model: string
    promptVersionId: string
    bundleHash: string
    bundleContextHash: string
    createdAt: string
    segmented: boolean
    segmentCount: number | null
    segmentIds: string[] | null
    atomCount: number | null
    estimatedInputTokens: number | null
    rawOutputJson: unknown
  } | null
}

interface ApiErrorResponse {
  error?: {
    code?: string
    message?: string
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function makeClientRunId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `demo-classify-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function parsePositiveNumber(value: string, field: string): { value?: number; error?: string } {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: `${field} must be a positive number` }
  }
  return { value: parsed }
}

function formatApiError(data: unknown, fallback: string) {
  const apiError = data as ApiErrorResponse
  const code = apiError.error?.code ? `[${apiError.error.code}] ` : ''
  return `${code}${apiError.error?.message || fallback}`
}

function StepChip({ state }: { state: StepState }) {
  const styles: Record<StepState, string> = {
    locked: 'bg-gray-100 text-gray-500',
    ready: 'bg-blue-100 text-blue-700',
    working: 'bg-amber-100 text-amber-700',
    done: 'bg-green-100 text-green-700',
  }

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[state]}`}>
      {state}
    </span>
  )
}

function StepCard({
  number,
  title,
  state,
  summary,
  children,
}: {
  number: string
  title: string
  state: StepState
  summary: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">
            {number}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
              <StepChip state={state} />
            </div>
            <p className="mt-1 text-sm text-gray-600">{summary}</p>
          </div>
        </div>
      </div>
      <div className="space-y-4 px-6 py-5">{children}</div>
    </section>
  )
}

export default function DemoClient() {
  const [file, setFile] = useState<File | null>(null)
  const [sourceOverride, setSourceOverride] = useState('')
  const [timezone, setTimezone] = useState('America/Los_Angeles')
  const [importEntryMode, setImportEntryMode] = useState<ImportEntryMode>('upload')
  const [importStatus, setImportStatus] = useState<UploadStatus>('idle')
  const [importResult, setImportResult] = useState<DemoImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importRecoveryMessage, setImportRecoveryMessage] = useState<string | null>(null)
  const [selectedImportBatch, setSelectedImportBatch] = useState<DemoImportBatch | null>(null)
  const [existingBatches, setExistingBatches] = useState<DemoImportBatch[]>([])
  const [loadingExistingBatches, setLoadingExistingBatches] = useState(false)
  const [existingBatchesError, setExistingBatchesError] = useState<string | null>(null)
  const [existingBatchesLoaded, setExistingBatchesLoaded] = useState(false)

  const [defaultClassifyPromptVersions, setDefaultClassifyPromptVersions] = useState<{
    stub: PromptVersion | null
    real: PromptVersion | null
  }>({ stub: null, real: null })
  const [selectedClassifyPromptVersions, setSelectedClassifyPromptVersions] = useState<{
    stub: PromptVersion | null
    real: PromptVersion | null
  }>({ stub: null, real: null })
  const [loadingPromptVersions, setLoadingPromptVersions] = useState(false)
  const [promptVersionError, setPromptVersionError] = useState<string | null>(null)
  const [classifyMode, setClassifyMode] = useState<ClassifyMode>('stub')
  const [classifyInFlight, setClassifyInFlight] = useState(false)
  const [classifyStopInFlight, setClassifyStopInFlight] = useState(false)
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null)
  const [classifyStatus, setClassifyStatus] = useState<ClassifyRunStatus | null>(null)
  const [classifyPollRunId, setClassifyPollRunId] = useState<string | null>(null)
  const [classifyError, setClassifyError] = useState<string | null>(null)

  const [filterProfiles, setFilterProfiles] = useState<FilterProfile[]>([])
  const [loadingFilterProfiles, setLoadingFilterProfiles] = useState(false)
  const [filterProfileError, setFilterProfileError] = useState<string | null>(null)
  const [selectedFilterProfileId, setSelectedFilterProfileId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [maxInputTokens, setMaxInputTokens] = useState('12000')
  const [summarizeMode, setSummarizeMode] = useState<SummarizeMode>('stub')
  const [provider, setProvider] = useState<ProviderId>('openai')
  const [model, setModel] = useState(PROVIDER_MODELS.openai.models[0])
  const [budgetPerRun, setBudgetPerRun] = useState('5.00')
  const [budgetPerDay, setBudgetPerDay] = useState('20.00')
  const [createRunInFlight, setCreateRunInFlight] = useState(false)
  const [createRunError, setCreateRunError] = useState<string | null>(null)
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null)
  const [runDetailError, setRunDetailError] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [summarizeError, setSummarizeError] = useState<string | null>(null)

  const [selectedOutputDay, setSelectedOutputDay] = useState('')
  const [outputLoading, setOutputLoading] = useState(false)
  const [outputError, setOutputError] = useState<string | null>(null)
  const [outputResponse, setOutputResponse] = useState<OutputResponse | null>(null)
  const [exportInFlight, setExportInFlight] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportValidationError, setExportValidationError] = useState<string | null>(null)
  const [exportResult, setExportResult] = useState<{ fileCount: number; outputDir: string; files: string[] } | null>(null)
  const [exportOutputDir, setExportOutputDir] = useState('./demo/demo-run')
  const [exportPrivacyTier, setExportPrivacyTier] = useState<'private' | 'public'>('private')

  const classifyAbortRef = useRef<AbortController | null>(null)
  const summarizeLoopRef = useRef<{ stop: () => void } | null>(null)

  const importBatch = selectedImportBatch
  const activeClassifyPromptVersion =
    classifyMode === 'stub'
      ? selectedClassifyPromptVersions.stub ?? defaultClassifyPromptVersions.stub
      : selectedClassifyPromptVersions.real ?? defaultClassifyPromptVersions.real
  const activeClassifyCompatibility = activeClassifyPromptVersion?.compatibility[
    classifyMode === 'stub' ? 'CLASSIFY_STUB' : 'CLASSIFY_REAL'
  ]
  const classifyPromptInvalid = !!activeClassifyPromptVersion && !activeClassifyCompatibility?.valid
  const effectiveClassifyResult = classifyResult ?? (
    classifyStatus?.status === 'succeeded'
      ? {
          classifyRunId: classifyStatus.id,
          importBatchId: classifyStatus.importBatchId,
          labelSpec: classifyStatus.labelSpec,
          mode: classifyStatus.mode,
          totals: classifyStatus.totals,
        }
      : null
  )
  const classifyRunning = classifyInFlight || classifyStatus?.status === 'running'
  const classifyDone = !!effectiveClassifyResult
  const runDone = runDetail?.status === 'completed'
  const availableSources = useMemo(() => {
    if (!importBatch) return []
    return getImportBatchSources(importBatch)
  }, [importBatch])
  const modelOptions = PROVIDER_MODELS[provider].models
  const effectiveSummarizeModel = summarizeMode === 'stub' ? 'stub_summarizer_v1' : model
  const succeededJobs = useMemo(
    () => runDetail?.jobs.filter((job) => job.status === 'succeeded') ?? [],
    [runDetail],
  )
  const selectedOutputJob = succeededJobs.find((job) => job.dayDate === selectedOutputDay) ?? succeededJobs[0] ?? null

  const step1State: StepState =
    importBatch ? 'done' : importStatus === 'uploading' ? 'working' : 'ready'
  const step2State: StepState =
    !importBatch ? 'locked' : classifyDone ? 'done' : classifyRunning ? 'working' : 'ready'
  const step3State: StepState =
    !classifyDone ? 'locked' : runDone ? 'done' : createRunInFlight || summarizing || !!runDetail ? 'working' : 'ready'
  const step4State: StepState =
    !runDone ? 'locked' : outputResponse || exportResult ? 'done' : exportInFlight || outputLoading ? 'working' : 'ready'

  const ensurePromptVersions = useCallback(async () => {
    if (loadingPromptVersions || (defaultClassifyPromptVersions.stub && defaultClassifyPromptVersions.real)) return

    setLoadingPromptVersions(true)
    setPromptVersionError(null)
    try {
      const loadCanonicalPromptVersion = async (mode: ClassifyMode) => {
        const res = await fetch(`/api/distill/prompt-versions?stage=classify&default=true&mode=${mode}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(formatApiError(data, `Failed to load ${mode} classify prompt (${res.status})`))
        }

        return ((data as { promptVersion?: PromptVersion }).promptVersion ?? null) as PromptVersion | null
      }

      const [stub, real] = await Promise.all([
        loadCanonicalPromptVersion('stub'),
        loadCanonicalPromptVersion('real'),
      ])

      setDefaultClassifyPromptVersions({ stub, real })
      setSelectedClassifyPromptVersions((current) => ({
        stub: current.stub ?? stub,
        real: current.real ?? real,
      }))
    } catch (error) {
      setPromptVersionError(error instanceof Error ? error.message : 'Failed to load prompt versions')
    } finally {
      setLoadingPromptVersions(false)
    }
  }, [defaultClassifyPromptVersions.real, defaultClassifyPromptVersions.stub, loadingPromptVersions])

  const ensureFilterProfiles = useCallback(async () => {
    if (loadingFilterProfiles || filterProfiles.length > 0) return

    setLoadingFilterProfiles(true)
    setFilterProfileError(null)
    try {
      const res = await fetch('/api/distill/filter-profiles')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFilterProfileError(formatApiError(data, `Failed to load filter profiles (${res.status})`))
        return
      }

      const profiles = (data.items ?? []) as FilterProfile[]
      setFilterProfiles(profiles)

      const preferred = profiles.find((profile) => profile.name === 'professional-only') ?? profiles[0]
      if (preferred) {
        setSelectedFilterProfileId(preferred.id)
      }
    } catch (error) {
      setFilterProfileError(error instanceof Error ? error.message : 'Failed to load filter profiles')
    } finally {
      setLoadingFilterProfiles(false)
    }
  }, [filterProfiles.length, loadingFilterProfiles])

  const loadExistingBatches = useCallback(async (force = false) => {
    if (loadingExistingBatches || (existingBatchesLoaded && !force)) return

    setLoadingExistingBatches(true)
    setExistingBatchesError(null)
    try {
      const res = await fetch('/api/distill/import-batches?limit=50')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setExistingBatchesError(formatApiError(data, `Failed to load import batches (${res.status})`))
        return
      }

      const batches = ((data.items ?? []) as DemoImportBatch[]).filter((batch) => isReusableImportBatch(batch))
      setExistingBatches(batches)
      setExistingBatchesLoaded(true)
    } catch (error) {
      setExistingBatchesError(error instanceof Error ? error.message : 'Failed to load import batches')
    } finally {
      setLoadingExistingBatches(false)
    }
  }, [existingBatchesLoaded, loadingExistingBatches])

  const fetchRunDetail = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/distill/runs/${runId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRunDetailError(formatApiError(data, `Failed to load run (${res.status})`))
        return
      }
      setRunDetail(data as RunDetail)
      setRunDetailError(null)
    } catch (error) {
      setRunDetailError(error instanceof Error ? error.message : 'Failed to load run')
    }
  }, [])

  const refreshClassifyStatus = useCallback(async (classifyRunId: string) => {
    const res = await fetch(`/api/distill/classify-runs/${classifyRunId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(formatApiError(data, `Failed to load classify status (${res.status})`))
    }
    setClassifyStatus(data as ClassifyRunStatus)
  }, [])

  useEffect(() => {
    if (importBatch) {
      void ensurePromptVersions()
    }
  }, [ensurePromptVersions, importBatch])

  useEffect(() => {
    if (classifyDone) {
      void ensureFilterProfiles()
    }
  }, [classifyDone, ensureFilterProfiles])

  useEffect(() => {
    if (!runDetail?.id) return
    setExportOutputDir(`./demo/${runDetail.id}`)
  }, [runDetail?.id])

  useEffect(() => {
    if (!runDone) return
    if (selectedOutputDay && succeededJobs.some((job) => job.dayDate === selectedOutputDay)) return
    if (succeededJobs[0]) {
      setSelectedOutputDay(succeededJobs[0].dayDate)
    }
  }, [runDone, selectedOutputDay, succeededJobs])

  useEffect(() => {
    return () => {
      classifyAbortRef.current?.abort()
      summarizeLoopRef.current?.stop()
    }
  }, [])

  usePolling<ClassifyRunStatus>({
    url: classifyPollRunId ? `/api/distill/classify-runs/${classifyPollRunId}` : null,
    intervalMs: CLASSIFY_POLL_INTERVAL_MS,
    enabled: !!classifyPollRunId && !TERMINAL_CLASSIFY_STATUSES.has(classifyStatus?.status ?? 'running'),
    onData: (data) => {
      setClassifyStatus(data)
      if (TERMINAL_CLASSIFY_STATUSES.has(data.status)) {
        setClassifyPollRunId(null)
      }
    },
    onTerminal: (data) => TERMINAL_CLASSIFY_STATUSES.has(data.status),
    onError: (error) => {
      setClassifyError((current) => current ?? error.message)
      setClassifyPollRunId(null)
    },
  })

  useEffect(() => {
    if (!runDetail?.id || !selectedOutputJob) return

    let cancelled = false
    setOutputLoading(true)
    setOutputError(null)

    ;(async () => {
      try {
        const res = await fetch(`/api/distill/runs/${runDetail.id}/jobs/${selectedOutputJob.dayDate}/output`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setOutputError(formatApiError(data, `Failed to load output (${res.status})`))
          return
        }
        setOutputResponse(data as OutputResponse)
      } catch (error) {
        if (!cancelled) {
          setOutputError(error instanceof Error ? error.message : 'Failed to load output')
        }
      } finally {
        if (!cancelled) {
          setOutputLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [runDetail?.id, selectedOutputJob])

  const resetDownstreamState = () => {
    classifyAbortRef.current?.abort()
    summarizeLoopRef.current?.stop()
    classifyAbortRef.current = null
    summarizeLoopRef.current = null
    setClassifyInFlight(false)
    setClassifyStopInFlight(false)
    setClassifyResult(null)
    setClassifyStatus(null)
    setClassifyPollRunId(null)
    setClassifyError(null)
    setCreateRunError(null)
    setRunDetail(null)
    setRunDetailError(null)
    setSummarizing(false)
    setSummarizeError(null)
    setSelectedOutputDay('')
    setOutputResponse(null)
    setOutputError(null)
    setExportError(null)
    setExportValidationError(null)
    setExportResult(null)
  }

  const clearSelectedImportBatch = () => {
    setSelectedImportBatch(null)
    setStartDate('')
    setEndDate('')
    setSelectedSources([])
  }

  const bindSelectedImportBatch = (batch: DemoImportBatch) => {
    clearSelectedImportBatch()
    resetDownstreamState()
    setSelectedImportBatch(batch)
    setStartDate(batch.stats.coverage_start)
    setEndDate(batch.stats.coverage_end)
    setSelectedSources(getImportBatchSources(batch))
    setImportStatus('success')
    setImportError(null)
  }

  const handleImportEntryModeChange = async (nextMode: ImportEntryMode) => {
    if (nextMode === importEntryMode) return

    setImportEntryMode(nextMode)
    setImportError(null)
    setImportRecoveryMessage(null)
    setImportStatus('idle')
    clearSelectedImportBatch()
    resetDownstreamState()

    if (nextMode === 'existing') {
      await loadExistingBatches()
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
    setImportEntryMode('upload')
    setImportStatus('idle')
    setImportResult(null)
    setImportError(null)
    setImportRecoveryMessage(null)
    clearSelectedImportBatch()
    resetDownstreamState()
  }

  const handleExistingBatchSelect = (batch: DemoImportBatch) => {
    setImportRecoveryMessage(null)
    bindSelectedImportBatch(batch)
  }

  const handleSourceToggle = (source: string) => {
    setSelectedSources((current) =>
      current.includes(source) ? current.filter((item) => item !== source) : [...current, source],
    )
  }

  const handleImport = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) return

    setImportEntryMode('upload')
    setImportStatus('uploading')
    setImportError(null)
    setImportRecoveryMessage(null)
    setExistingBatchesLoaded(false)
    clearSelectedImportBatch()
    resetDownstreamState()

    const formData = new FormData()
    formData.append('file', file)
    if (sourceOverride) formData.append('sourceOverride', sourceOverride)
    if (timezone) formData.append('timezone', timezone)

    try {
      const res = await fetch('/api/distill/import', { method: 'POST', body: formData })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setImportError(formatApiError(data, 'Import failed'))
        setImportStatus('error')
        return
      }

      const result = data as DemoImportResult
      setImportResult(result)
      if (isDuplicateImportResult(result)) {
        setImportStatus('success')
        setImportEntryMode('existing')
        setImportRecoveryMessage(
          'This file was already imported. Choose an existing import batch with stored atoms to continue.',
        )
        await loadExistingBatches(true)
        return
      }

      bindSelectedImportBatch(toDemoImportBatch(result))
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import failed')
      setImportStatus('error')
    }
  }

  const handleClassify = async () => {
    if (!importBatch) return

    await ensurePromptVersions()

    const promptVersion = activeClassifyPromptVersion
    if (!promptVersion) {
      setClassifyError(
        classifyMode === 'real'
          ? 'No real classify prompt version found. Run `npx prisma db seed`.'
          : 'No stub classify prompt version found. Run `npx prisma db seed`.',
      )
      return
    }
    if (classifyPromptInvalid) {
      setClassifyError(
        activeClassifyCompatibility?.reasons[0] || 'Selected prompt is incompatible with the requested classify mode.',
      )
      return
    }

    const classifyRunId = makeClientRunId()
    const classifyModel = classifyMode === 'stub' ? 'stub_v1' : 'gpt-4o'

    classifyAbortRef.current?.abort()
    classifyAbortRef.current = new AbortController()

    setClassifyInFlight(true)
    setClassifyError(null)
    setClassifyResult(null)
    setClassifyStatus(null)
    setClassifyPollRunId(classifyRunId)

    try {
      const res = await fetch('/api/distill/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classifyRunId,
          importBatchId: importBatch.id,
          model: classifyModel,
          promptVersionId: promptVersion.id,
          mode: classifyMode,
        }),
        signal: classifyAbortRef.current.signal,
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        if ((data as ApiErrorResponse).error?.code === USER_STOPPED_CODE) {
          setClassifyError(null)
          await refreshClassifyStatus(classifyRunId).catch(() => {})
          return
        }
        setClassifyError(formatApiError(data, 'Classification failed'))
        await refreshClassifyStatus(classifyRunId).catch(() => {})
        return
      }

      setClassifyResult(data as ClassifyResult)
      await refreshClassifyStatus(classifyRunId)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
      setClassifyError(error instanceof Error ? error.message : 'Classification failed')
    } finally {
      setClassifyInFlight(false)
      classifyAbortRef.current = null
    }
  }

  const handleStopClassify = async () => {
    const activeRunId = classifyStatus?.id ?? classifyPollRunId
    if (!activeRunId) return

    setClassifyStopInFlight(true)
    setClassifyError(null)

    try {
      const res = await fetch(`/api/distill/classify-runs/${activeRunId}/stop`, {
        method: 'POST',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setClassifyError(formatApiError(data, 'Failed to stop classification'))
        return
      }

      classifyAbortRef.current?.abort()
      await refreshClassifyStatus(activeRunId).catch(() => {})
    } catch (error) {
      setClassifyError(error instanceof Error ? error.message : 'Failed to stop classification')
    } finally {
      setClassifyStopInFlight(false)
    }
  }

  const handleProviderChange = (nextProvider: ProviderId) => {
    setProvider(nextProvider)
    setModel(PROVIDER_MODELS[nextProvider].models[0])
  }

  const handleCreateRun = async () => {
    if (!importBatch || !effectiveClassifyResult) return
    if (!selectedFilterProfileId) {
      setCreateRunError('Select a filter profile before creating a run.')
      return
    }
    if (!startDate || !endDate) {
      setCreateRunError('Start and end date are required.')
      return
    }
    if (selectedSources.length === 0) {
      setCreateRunError('Select at least one source.')
      return
    }

    const parsedMaxInputTokens = Number.parseInt(maxInputTokens, 10)
    if (!Number.isInteger(parsedMaxInputTokens) || parsedMaxInputTokens < 1) {
      setCreateRunError('maxInputTokens must be a positive integer.')
      return
    }

    let budgetPolicy: { maxUsdPerRun: number; maxUsdPerDay: number } | undefined
    if (summarizeMode === 'real') {
      const perRun = parsePositiveNumber(budgetPerRun, 'Max USD per run')
      if (perRun.error) {
        setCreateRunError(perRun.error)
        return
      }
      const perDay = parsePositiveNumber(budgetPerDay, 'Max USD per day')
      if (perDay.error) {
        setCreateRunError(perDay.error)
        return
      }
      budgetPolicy = {
        maxUsdPerRun: perRun.value!,
        maxUsdPerDay: perDay.value!,
      }
    }

    setCreateRunInFlight(true)
    setCreateRunError(null)
    setRunDetail(null)
    setRunDetailError(null)
    setSummarizeError(null)

    try {
      const res = await fetch('/api/distill/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importBatchId: importBatch.id,
          startDate,
          endDate,
          sources: selectedSources,
          filterProfileId: selectedFilterProfileId,
          model: effectiveSummarizeModel,
          labelSpec: effectiveClassifyResult.labelSpec,
          maxInputTokens: parsedMaxInputTokens,
          ...(budgetPolicy ? { budgetPolicy } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateRunError(formatApiError(data, 'Failed to create run'))
        return
      }

      await fetchRunDetail((data as { id: string }).id)
      setSelectedOutputDay('')
      setOutputResponse(null)
      setExportResult(null)
    } catch (error) {
      setCreateRunError(error instanceof Error ? error.message : 'Failed to create run')
    } finally {
      setCreateRunInFlight(false)
    }
  }

  const handleStartSummarizing = () => {
    if (!runDetail || summarizing) return

    setSummarizing(true)
    setSummarizeError(null)

    summarizeLoopRef.current = startAutoRunLoop({
      url: `/api/distill/runs/${runDetail.id}/tick`,
      requestBody: { maxJobs: 1 },
      onTick: () => {
        void fetchRunDetail(runDetail.id)
      },
      isTerminal: (data) => TERMINAL_RUN_STATUSES.has((data as { runStatus: string }).runStatus),
      onError: (error) => {
        setSummarizeError(`[${error.code}] ${error.message}`)
      },
      onStopped: () => {
        setSummarizing(false)
        summarizeLoopRef.current = null
        void fetchRunDetail(runDetail.id)
      },
    })
  }

  const handleStopSummarizing = () => {
    summarizeLoopRef.current?.stop()
  }

  const handleExport = async () => {
    if (!runDetail) return
    if (exportOutputDir.includes('..')) {
      setExportValidationError('Output directory must not contain "..".')
      return
    }
    if (exportOutputDir.startsWith('/')) {
      setExportValidationError('Output directory must stay relative to exports/.')
      return
    }
    if (!exportOutputDir.trim()) {
      setExportValidationError('Output directory is required.')
      return
    }

    setExportInFlight(true)
    setExportError(null)
    setExportValidationError(null)
    setExportResult(null)

    try {
      const res = await fetch(`/api/distill/runs/${runDetail.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outputDir: exportOutputDir,
          privacyTier: exportPrivacyTier,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setExportError(formatApiError(data, 'Export failed'))
        return
      }

      setExportResult(data as { fileCount: number; outputDir: string; files: string[] })
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setExportInFlight(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="rounded-3xl border border-gray-200 bg-white px-8 py-8 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">
                Guided Demo
              </p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-gray-900">
                Import, classify, summarize, and export in one foreground flow.
              </h1>
              <p className="mt-3 max-w-2xl text-base text-gray-600">
                This wizard keeps every step explicit. Nothing runs on load, nothing retries in the background,
                and real-mode spend caps are frozen into the run before summarization starts.
              </p>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-blue-800">
              <div className="font-medium">Flow rules</div>
              <div className="mt-1">Dry-run defaults first. Advanced tooling stays available after the guided path succeeds.</div>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-6">
            <StepCard
              number="1"
              title="Import"
              state={step1State}
              summary="Upload a new export file or choose an existing reusable import batch."
            >
              <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
                <div className="text-sm font-medium text-gray-900">Choose your starting point</div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      void handleImportEntryModeChange('upload')
                    }}
                    className={`rounded-full px-4 py-2 text-sm font-medium ${
                      importEntryMode === 'upload'
                        ? 'bg-gray-900 text-white'
                        : 'border border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    Import new file
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleImportEntryModeChange('existing')
                    }}
                    className={`rounded-full px-4 py-2 text-sm font-medium ${
                      importEntryMode === 'existing'
                        ? 'bg-blue-700 text-white'
                        : 'border border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    Use existing import batch
                  </button>
                </div>
              </div>

              {importEntryMode === 'upload' && (
                <form className="space-y-4" onSubmit={handleImport}>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">Export file</label>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleFileChange}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-full file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-gray-700"
                    />
                    {file && (
                      <p className="mt-2 text-sm text-gray-600">
                        {file.name} · {formatBytes(file.size)}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">Source override</label>
                      <select
                        value={sourceOverride}
                        onChange={(event) => setSourceOverride(event.target.value)}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">Auto-detect</option>
                        <option value="chatgpt">ChatGPT</option>
                        <option value="claude">Claude</option>
                        <option value="grok">Grok</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">Timezone</label>
                      <select
                        value={timezone}
                        onChange={(event) => setTimezone(event.target.value)}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
                        <option value="America/Denver">Mountain (Denver)</option>
                        <option value="America/Chicago">Central (Chicago)</option>
                        <option value="America/New_York">Eastern (New York)</option>
                        <option value="UTC">UTC</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!file || importStatus === 'uploading'}
                    className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {importStatus === 'uploading' ? 'Importing…' : 'Import file'}
                  </button>
                </form>
              )}

              {importEntryMode === 'existing' && (
                <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
                  <div className="text-sm font-medium text-blue-900">Reusable import batches</div>
                  <p className="text-sm text-blue-700">
                    Pick one previously imported batch with stored atoms. The wizard stays single-batch for now.
                  </p>

                  {loadingExistingBatches && (
                    <p className="text-sm text-gray-500">Loading existing import batches…</p>
                  )}

                  {existingBatchesError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {existingBatchesError}
                    </div>
                  )}

                  {!loadingExistingBatches && !existingBatchesError && existingBatches.length === 0 && (
                    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
                      No reusable import batches are available yet. Import a file first.
                    </div>
                  )}

                  {!loadingExistingBatches && existingBatches.length > 0 && (
                    <div className="space-y-3">
                      {existingBatches.map((batch) => {
                        const isSelected = selectedImportBatch?.id === batch.id
                        return (
                          <button
                            key={batch.id}
                            type="button"
                            onClick={() => handleExistingBatchSelect(batch)}
                            className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                              isSelected
                                ? 'border-blue-700 bg-white shadow-sm'
                                : 'border-blue-200 bg-white hover:border-blue-400'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-gray-900">{batch.originalFilename}</div>
                                <div className="mt-1 text-xs text-gray-500">
                                  {batch.id} · {new Date(batch.createdAt).toLocaleString()}
                                </div>
                              </div>
                              <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium uppercase tracking-wide text-blue-700">
                                {batch.source}
                              </span>
                            </div>
                            <div className="mt-3 grid gap-2 text-sm text-gray-600 md:grid-cols-2">
                              <div>
                                Coverage: {batch.stats.coverage_start} to {batch.stats.coverage_end}
                              </div>
                              <div>Timezone: {batch.timezone}</div>
                              <div>Stored atoms: {batch.storedCounts.messageAtoms}</div>
                              <div>Raw entries: {batch.storedCounts.rawEntries}</div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {importError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {importError}
                </div>
              )}

              {importRecoveryMessage && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {importRecoveryMessage}
                </div>
              )}

              {importResult && (
                <div className="space-y-3 rounded-2xl border border-gray-200 bg-white px-5 py-4">
                  <div className="text-sm font-medium text-gray-900">Last upload attempt</div>
                  <dl className="grid gap-x-4 gap-y-2 text-sm md:grid-cols-2">
                    <div>
                      <dt className="text-gray-500">Batch</dt>
                      <dd className="font-medium text-gray-900">{importResult.importBatch.id}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Detected source</dt>
                      <dd className="font-medium capitalize text-gray-900">{importResult.importBatch.source.toLowerCase()}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Coverage</dt>
                      <dd className="font-medium text-gray-900">
                        {importResult.importBatch.stats.coverage_start} to {importResult.importBatch.stats.coverage_end}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Timezone</dt>
                      <dd className="font-medium text-gray-900">{importResult.importBatch.timezone}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Stored message atoms</dt>
                      <dd className="font-medium text-gray-900">{importResult.created.messageAtoms}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Stored raw entries</dt>
                      <dd className="font-medium text-gray-900">{importResult.created.rawEntries}</dd>
                    </div>
                  </dl>
                  {importResult.warnings.length > 0 && (
                    <ul className="space-y-1 text-sm text-amber-700">
                      {importResult.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {selectedImportBatch && (
                <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 px-5 py-4">
                  <div className="text-sm font-medium text-green-800">Selected batch for this run</div>
                  <dl className="grid gap-x-4 gap-y-2 text-sm md:grid-cols-2">
                    <div>
                      <dt className="text-gray-500">Batch</dt>
                      <dd className="font-medium text-gray-900">{selectedImportBatch.id}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Source</dt>
                      <dd className="font-medium capitalize text-gray-900">{selectedImportBatch.source}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Coverage</dt>
                      <dd className="font-medium text-gray-900">
                        {selectedImportBatch.stats.coverage_start} to {selectedImportBatch.stats.coverage_end}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Timezone</dt>
                      <dd className="font-medium text-gray-900">{selectedImportBatch.timezone}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Stored message atoms</dt>
                      <dd className="font-medium text-gray-900">{selectedImportBatch.storedCounts.messageAtoms}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Stored raw entries</dt>
                      <dd className="font-medium text-gray-900">{selectedImportBatch.storedCounts.rawEntries}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </StepCard>

            <StepCard
              number="2"
              title="Classify"
              state={step2State}
              summary="Run stub classification by default, or switch to real mode explicitly."
            >
              {!importBatch && (
                <p className="text-sm text-gray-500">Import a file or select an existing batch first to unlock classification.</p>
              )}

              {importBatch && (
                <>
                  <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
                    <div className="text-sm font-medium text-blue-800">Mode</div>
                    <div className="flex flex-col gap-3 md:flex-row">
                      <label className="flex items-center gap-2 text-sm text-gray-800">
                        <input
                          type="radio"
                          name="classify-mode"
                          checked={classifyMode === 'stub'}
                          onChange={() => setClassifyMode('stub')}
                          disabled={classifyRunning}
                        />
                        Stub (Recommended)
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-800">
                        <input
                          type="radio"
                          name="classify-mode"
                          checked={classifyMode === 'real'}
                          onChange={() => setClassifyMode('real')}
                          disabled={classifyRunning}
                        />
                        Real (LLM-backed)
                      </label>
                    </div>
                    <p className="text-sm text-blue-700">
                      {classifyMode === 'stub'
                        ? 'Deterministic labels, no API cost.'
                        : 'Requires configured LLM credentials. Uses the persisted classify run for progress.'}
                    </p>
                  </div>

                  {promptVersionError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {promptVersionError}
                    </div>
                  )}

                  <ClassifyPromptPicker
                    mode={classifyMode}
                    value={activeClassifyPromptVersion}
                    forceExpanded={!!promptVersionError || !activeClassifyPromptVersion || classifyPromptInvalid}
                    onSelect={(version) =>
                      setSelectedClassifyPromptVersions((current) => ({
                        ...current,
                        [classifyMode]: version,
                      }))
                    }
                  />

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleClassify}
                      disabled={
                        classifyRunning ||
                        classifyStopInFlight ||
                        loadingPromptVersions ||
                        !activeClassifyPromptVersion ||
                        classifyPromptInvalid
                      }
                      className="rounded-full bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      {classifyRunning ? 'Classifying…' : `Classify (${classifyMode})`}
                    </button>
                    {(classifyRunning || classifyStatus?.control.stopRequested) && (
                      <button
                        type="button"
                        onClick={handleStopClassify}
                        disabled={classifyStopInFlight || classifyStatus?.control.stopRequested}
                        className="rounded-full border border-amber-300 bg-white px-5 py-2.5 text-sm font-medium text-amber-800 hover:border-amber-400 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-amber-200 disabled:text-amber-500"
                      >
                        {classifyStopInFlight || classifyStatus?.control.stopRequested ? 'Stopping…' : 'Stop classify'}
                      </button>
                    )}
                    {loadingPromptVersions && (
                      <span className="text-sm text-gray-500">Loading prompt versions…</span>
                    )}
                  </div>

                  {classifyError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {classifyError}
                    </div>
                  )}

                  {classifyStatus && (
                    <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-gray-900">Classify status</div>
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${getClassifyStatusColor(classifyStatus.status)}`}>
                          {classifyStatus.status}
                        </span>
                        <code className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
                          {classifyStatus.id}
                        </code>
                      </div>
                      <div className="mt-3">
                        <div className="mb-1 flex justify-between text-xs text-gray-500">
                          <span>
                            {classifyStatus.progress.processedAtoms} / {classifyStatus.progress.totalAtoms} user atoms processed
                          </span>
                          <span>
                            {formatProgressPercent(
                              classifyStatus.progress.processedAtoms,
                              classifyStatus.progress.totalAtoms,
                            )}%
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-gray-100">
                          <div
                            className="h-2 rounded-full bg-blue-500 transition-all"
                            style={{
                              width: `${formatProgressPercent(
                                classifyStatus.progress.processedAtoms,
                                classifyStatus.progress.totalAtoms,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                      {classifyStatus.control.stopRequested && (
                        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          Stop requested. The current atom may finish before classify stops.
                        </div>
                      )}
                      <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm md:grid-cols-2">
                        <div className="md:col-span-2">
                          <dt className="text-gray-500">Prompt</dt>
                          <dd className="font-medium text-gray-900">
                            {classifyStatus.labelSpec.promptName} / {classifyStatus.labelSpec.promptVersionLabel}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Remaining user atoms</dt>
                          <dd className="font-medium text-gray-900">
                            {Math.max(classifyStatus.progress.totalAtoms - classifyStatus.progress.processedAtoms, 0)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Newly labeled</dt>
                          <dd className="font-medium text-gray-900">{classifyStatus.totals.newlyLabeled}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Skipped already labeled</dt>
                          <dd className="font-medium text-gray-900">{classifyStatus.totals.skippedAlreadyLabeled}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Skipped invalid model outputs</dt>
                          <dd className="font-medium text-gray-900">{classifyStatus.warnings.skippedBadOutput}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Aliased categories</dt>
                          <dd className="font-medium text-gray-900">{classifyStatus.warnings.aliasedCount}</dd>
                        </div>
                        {classifyStatus.usage.costUsd !== null && (
                          <div>
                            <dt className="text-gray-500">Cost</dt>
                            <dd className="font-medium text-gray-900">${classifyStatus.usage.costUsd.toFixed(4)}</dd>
                          </div>
                        )}
                        <div>
                          <dt className="text-gray-500">Latest checkpoint</dt>
                          <dd className="font-medium text-gray-900">{new Date(classifyStatus.updatedAt).toLocaleTimeString()}</dd>
                        </div>
                        {classifyStatus.checkpoint.lastAtomStableIdProcessed && (
                          <div className="md:col-span-2">
                            <dt className="text-gray-500">Last processed atom</dt>
                            <dd className="font-medium text-gray-900">
                              <code className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                                {classifyStatus.checkpoint.lastAtomStableIdProcessed}
                              </code>
                            </dd>
                          </div>
                        )}
                        {classifyStatus.lastError && (
                          <div className="md:col-span-2">
                            <dt className="text-gray-500">Last error</dt>
                            <dd className={`font-medium ${
                              classifyStatus.lastError.code === USER_STOPPED_CODE ? 'text-amber-700' : 'text-red-700'
                            }`}>
                              [{classifyStatus.lastError.code}] {classifyStatus.lastError.message}
                            </dd>
                          </div>
                        )}
                      </dl>
                      <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                        Skipped invalid model outputs are non-fatal responses that failed JSON, category, or confidence
                        validation. Those atoms are safely skipped for this run. The dev-server CLI now prints classify
                        checkpoints so you can watch counts and spend move while real mode is running.
                      </div>
                      {classifyStatus.warnings.details && (
                        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
                          <div className="text-sm font-medium">Bad-output diagnostics</div>
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {Object.entries(classifyStatus.warnings.details.badOutputReasons)
                              .filter(([, count]) => count > 0)
                              .map(([reason, count]) => (
                                <div key={reason} className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2">
                                  <span>{BAD_OUTPUT_REASON_LABELS[reason as BadOutputReasonKey]}</span>
                                  <span className="font-medium">{count}</span>
                                </div>
                              ))}
                          </div>
                          {classifyStatus.warnings.details.badCategorySamples.length > 0 && (
                            <div className="mt-3">
                              <div className="text-xs font-medium uppercase tracking-[0.12em] text-amber-700">
                                Sample invalid categories
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {classifyStatus.warnings.details.badCategorySamples.map((sample) => (
                                  <code key={sample} className="rounded bg-white px-2 py-1 text-xs text-amber-900">
                                    {sample}
                                  </code>
                                ))}
                              </div>
                            </div>
                          )}
                          {classifyStatus.warnings.details.aliasedCategorySamples.length > 0 && (
                            <div className="mt-3">
                              <div className="text-xs font-medium uppercase tracking-[0.12em] text-amber-700">
                                Sample aliased categories
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {classifyStatus.warnings.details.aliasedCategorySamples.map((sample) => (
                                  <code key={sample} className="rounded bg-white px-2 py-1 text-xs text-amber-900">
                                    {sample}
                                  </code>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {classifyStatus.lastError?.code === USER_STOPPED_CODE && (
                        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          Classification stopped by user. You can start a new classify run later; already-labeled atoms
                          will be skipped.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </StepCard>

            <StepCard
              number="3"
              title="Summarize"
              state={step3State}
              summary="Freeze run config first, then explicitly start or stop sequential summarize ticks."
            >
              {!classifyDone && (
                <p className="text-sm text-gray-500">Classification must succeed before run creation is enabled.</p>
              )}

              {classifyDone && (
                <>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Filter profile</label>
                        <select
                          value={selectedFilterProfileId}
                          onChange={(event) => setSelectedFilterProfileId(event.target.value)}
                          disabled={loadingFilterProfiles || createRunInFlight}
                          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">{loadingFilterProfiles ? 'Loading profiles…' : 'Select profile'}</option>
                          {filterProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                            </option>
                          ))}
                        </select>
                        {filterProfileError && (
                          <p className="mt-2 text-sm text-red-600">{filterProfileError}</p>
                        )}
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-gray-700">Start date</label>
                          <input
                            type="date"
                            value={startDate}
                            onChange={(event) => setStartDate(event.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-gray-700">End date</label>
                          <input
                            type="date"
                            value={endDate}
                            onChange={(event) => setEndDate(event.target.value)}
                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Sources</label>
                        <div className="flex flex-wrap gap-2">
                          {availableSources.map((source) => (
                            <label
                              key={source}
                              className={`rounded-full border px-3 py-1.5 text-sm ${
                                selectedSources.includes(source)
                                  ? 'border-gray-900 bg-gray-900 text-white'
                                  : 'border-gray-300 bg-white text-gray-700'
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={selectedSources.includes(source)}
                                onChange={() => handleSourceToggle(source)}
                              />
                              {source}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Max input tokens</label>
                        <input
                          type="number"
                          min={1}
                          value={maxInputTokens}
                          onChange={(event) => setMaxInputTokens(event.target.value)}
                          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
                      <div className="text-sm font-medium text-blue-800">Execution mode</div>
                      <div className="flex flex-col gap-3">
                        <label className="flex items-center gap-2 text-sm text-gray-800">
                          <input
                            type="radio"
                            name="summarize-mode"
                            checked={summarizeMode === 'stub'}
                            onChange={() => setSummarizeMode('stub')}
                            disabled={createRunInFlight || summarizing}
                          />
                          Stub (Recommended)
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-800">
                          <input
                            type="radio"
                            name="summarize-mode"
                            checked={summarizeMode === 'real'}
                            onChange={() => setSummarizeMode('real')}
                            disabled={createRunInFlight || summarizing}
                          />
                          Real (LLM-backed)
                        </label>
                      </div>

                      {summarizeMode === 'real' && (
                        <div className="space-y-4 rounded-2xl border border-blue-200 bg-white px-4 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-700">Provider</label>
                              <select
                                value={provider}
                                onChange={(event) => handleProviderChange(event.target.value as ProviderId)}
                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                              >
                                {Object.entries(PROVIDER_MODELS).map(([providerId, value]) => (
                                  <option key={providerId} value={providerId}>
                                    {value.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-700">Model</label>
                              <select
                                value={model}
                                onChange={(event) => setModel(event.target.value)}
                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                              >
                                {modelOptions.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-700">Max USD per run</label>
                              <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={budgetPerRun}
                                onChange={(event) => setBudgetPerRun(event.target.value)}
                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-700">Max USD per day</label>
                              <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={budgetPerDay}
                                onChange={(event) => setBudgetPerDay(event.target.value)}
                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                              />
                            </div>
                          </div>

                          <p className="text-sm text-blue-700">
                            These caps are frozen into the run config and take precedence over env defaults for this run.
                          </p>
                        </div>
                      )}

                      {summarizeMode === 'stub' && (
                        <p className="text-sm text-blue-700">
                          Stub mode keeps summarization deterministic and cost-free. Budget controls stay hidden because the run does not spend real tokens.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleCreateRun}
                      disabled={createRunInFlight || summarizing}
                      className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      {createRunInFlight ? 'Creating run…' : 'Create summarization run'}
                    </button>

                    {runDetail && !TERMINAL_RUN_STATUSES.has(runDetail.status) && !summarizing && (
                      <button
                        type="button"
                        onClick={handleStartSummarizing}
                        className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
                      >
                        Start summarizing
                      </button>
                    )}

                    {summarizing && (
                      <button
                        type="button"
                        onClick={handleStopSummarizing}
                        className="rounded-full bg-amber-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-600"
                      >
                        Stop summarizing
                      </button>
                    )}
                  </div>

                  {createRunError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {createRunError}
                    </div>
                  )}

                  {runDetailError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {runDetailError}
                    </div>
                  )}

                  {summarizeError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {summarizeError}
                    </div>
                  )}

                  {runDetail && (
                    <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-gray-900">Run status</div>
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${getStatusColor(runDetail.status)}`}>
                          {runDetail.status}
                        </span>
                        <code className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">{runDetail.id}</code>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-emerald-500 transition-all"
                          style={{
                            width: `${formatProgressPercent(
                              runDetail.progress.succeeded + runDetail.progress.failed + runDetail.progress.cancelled,
                              runDetail.totals.jobs,
                            )}%`,
                          }}
                        />
                      </div>
                      <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm md:grid-cols-2">
                        <div>
                          <dt className="text-gray-500">Jobs</dt>
                          <dd className="font-medium text-gray-900">{runDetail.totals.jobs}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Completed jobs</dt>
                          <dd className="font-medium text-gray-900">
                            {runDetail.progress.succeeded + runDetail.progress.failed + runDetail.progress.cancelled}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Tokens</dt>
                          <dd className="font-medium text-gray-900">
                            {runDetail.totals.tokensIn.toLocaleString()} in / {runDetail.totals.tokensOut.toLocaleString()} out
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Cost</dt>
                          <dd className="font-medium text-gray-900">${runDetail.totals.costUsd.toFixed(4)}</dd>
                        </div>
                      </dl>
                      {runDone && (
                        <p className="mt-4 text-sm font-medium text-green-700">
                          Summarization completed. Step 4 is now unlocked.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </StepCard>

            <StepCard
              number="4"
              title="Use and Export"
              state={step4State}
              summary="Review a rendered output, then export the run or jump into advanced tooling."
            >
              {!runDone && (
                <p className="text-sm text-gray-500">Complete the summarize step to unlock outputs and export.</p>
              )}

              {runDone && runDetail && (
                <>
                  <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
                    <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                      <div className="text-sm font-medium text-gray-900">Rendered outputs</div>
                      {succeededJobs.map((job) => (
                        <button
                          key={job.dayDate}
                          type="button"
                          onClick={() => setSelectedOutputDay(job.dayDate)}
                          className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                            selectedOutputJob?.dayDate === job.dayDate
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                          }`}
                        >
                          {job.dayDate}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-4">
                      {outputLoading && (
                        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
                          Loading output…
                        </div>
                      )}

                      {outputError && (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                          {outputError}
                        </div>
                      )}

                      {outputResponse?.hasOutput && outputResponse.output && (
                        <div className="rounded-2xl border border-gray-200 bg-white">
                          <div className="border-b border-gray-100 px-5 py-4">
                            <div className="text-sm font-medium text-gray-900">
                              {outputResponse.dayDate}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-4 text-xs text-gray-500">
                              <span>Model: {outputResponse.output.model}</span>
                              <span>Atoms: {outputResponse.output.atomCount ?? 'n/a'}</span>
                              <span>Segmented: {outputResponse.output.segmented ? 'yes' : 'no'}</span>
                            </div>
                          </div>
                          <div className="px-5 py-5">
                            <div className="prose prose-sm max-w-none rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
                              <ReactMarkdown>{outputResponse.output.outputText}</ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-purple-100 bg-purple-50 px-5 py-4">
                    <div className="text-sm font-medium text-purple-900">Export</div>
                    <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                      <input
                        type="text"
                        value={exportOutputDir}
                        onChange={(event) => {
                          setExportOutputDir(event.target.value)
                          setExportValidationError(null)
                        }}
                        className="rounded-xl border border-purple-200 bg-white px-3 py-2 text-sm font-mono"
                      />
                      <select
                        value={exportPrivacyTier}
                        onChange={(event) => setExportPrivacyTier(event.target.value as 'private' | 'public')}
                        className="rounded-xl border border-purple-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="private">Private</option>
                        <option value="public">Public</option>
                      </select>
                    </div>
                    <p className="mt-2 text-sm text-purple-700">
                      Private includes user text. Public excludes atoms and sources.
                    </p>
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={handleExport}
                        disabled={exportInFlight}
                        className="rounded-full bg-purple-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                      >
                        {exportInFlight ? 'Exporting…' : 'Export run'}
                      </button>
                    </div>
                    {exportValidationError && (
                      <p className="mt-3 text-sm text-red-700">{exportValidationError}</p>
                    )}
                    {exportError && (
                      <p className="mt-3 text-sm text-red-700">{exportError}</p>
                    )}
                    {exportResult && (
                      <div className="mt-4 rounded-2xl border border-purple-200 bg-white px-4 py-3 text-sm text-purple-900">
                        Exported {exportResult.fileCount} file(s) to <code>{exportResult.outputDir}</code>.
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={`/distill/runs/${runDetail.id}`}
                      className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
                    >
                      Open run detail
                    </Link>
                    <Link
                      href={`/distill/studio?runId=${runDetail.id}${selectedOutputJob ? `&day=${selectedOutputJob.dayDate}` : ''}`}
                      className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
                    >
                      Open in Studio
                    </Link>
                    {importBatch && (
                      <Link
                        href={`/distill/import/inspect?importBatchId=${importBatch.id}`}
                        className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
                      >
                        Inspect imported atoms
                      </Link>
                    )}
                  </div>
                </>
              )}
            </StepCard>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
              <div className="text-sm font-semibold text-gray-900">Progress</div>
              <ul className="mt-3 space-y-2 text-sm text-gray-600">
                <li>1. Import {step1State === 'done' ? 'complete' : 'pending'}</li>
                <li>2. Classify {step2State === 'done' ? 'complete' : step2State}</li>
                <li>3. Summarize {step3State === 'done' ? 'complete' : step3State}</li>
                <li>4. Use and export {step4State === 'done' ? 'complete' : step4State}</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
              <div className="text-sm font-semibold text-gray-900">Advanced tooling</div>
              <p className="mt-2 text-sm text-gray-600">
                The guided flow is the default path. Power surfaces stay under <code>/distill/*</code>.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <Link href="/distill" className="text-sm text-blue-700 hover:underline">
                  Advanced dashboard
                </Link>
                <Link href="/distill/search" className="text-sm text-blue-700 hover:underline">
                  Search outputs
                </Link>
                <Link href="/distill/import" className="text-sm text-blue-700 hover:underline">
                  Raw import form
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
