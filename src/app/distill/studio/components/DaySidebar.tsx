'use client'

interface Job {
  dayDate: string
  status: string
  costUsd: number
  tokensIn: number
  tokensOut: number
  error: string | null
}

interface DaySidebarProps {
  jobs: Job[]
  selectedDay: string | null
  onDaySelect: (dayDate: string) => void
  anomalousDays?: Set<string>
}

const STATUS_GLYPHS: Record<string, { glyph: string; color: string }> = {
  succeeded: { glyph: '\u25CF', color: 'text-green-600' },
  failed:    { glyph: '\u2717', color: 'text-red-600' },
  running:   { glyph: '\u27F3', color: 'text-blue-500 animate-spin' },
  queued:    { glyph: '\u25CB', color: 'text-gray-400' },
  cancelled: { glyph: '\u2014', color: 'text-gray-300' },
}

function formatDayLabel(dayDate: string): string {
  const [year, month, day] = dayDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default function DaySidebar({ jobs, selectedDay, onDaySelect, anomalousDays }: DaySidebarProps) {
  const sorted = [...jobs].sort((a, b) => b.dayDate.localeCompare(a.dayDate))

  if (sorted.length === 0) {
    return (
      <div className="text-sm text-gray-400 p-4">
        This run has no days.
      </div>
    )
  }

  return (
    <div className="flex flex-col py-2">
      {sorted.map((job) => {
        const isSelected = job.dayDate === selectedDay
        const { glyph, color } = STATUS_GLYPHS[job.status] ?? STATUS_GLYPHS.queued

        const isAnomalous = anomalousDays?.has(job.dayDate) ?? false

        return (
          <button
            key={job.dayDate}
            onClick={() => onDaySelect(job.dayDate)}
            className={`flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors ${
              isSelected
                ? 'border-l-2 border-blue-600 bg-blue-50 text-gray-900'
                : 'border-l-2 border-transparent text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span className={`${color} text-xs inline-block w-4 text-center`}>{glyph}</span>
            <span>{formatDayLabel(job.dayDate)}</span>
            {isAnomalous && (
              <span className="text-amber-500 text-xs font-medium ml-auto" title="Cost anomaly">$</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
