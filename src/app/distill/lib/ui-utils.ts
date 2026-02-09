/**
 * Shared UI utility functions used by dashboard and run detail pages.
 */

export function getClassifyStatusColor(status: 'running' | 'succeeded' | 'failed'): string {
  switch (status) {
    case 'running':
      return 'bg-blue-200 text-blue-700'
    case 'succeeded':
      return 'bg-green-200 text-green-700'
    case 'failed':
      return 'bg-red-200 text-red-700'
    default:
      return 'bg-gray-200 text-gray-700'
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'queued':
      return 'bg-gray-200 text-gray-700'
    case 'processing':
    case 'running':
      return 'bg-blue-200 text-blue-700'
    case 'succeeded':
    case 'completed':
      return 'bg-green-200 text-green-700'
    case 'failed':
      return 'bg-red-200 text-red-700'
    case 'cancelled':
      return 'bg-yellow-200 text-yellow-700'
    default:
      return 'bg-gray-200 text-gray-700'
  }
}

export function getJobStatusColor(status: string): string {
  switch (status) {
    case 'queued':
      return 'bg-gray-200 text-gray-700'
    case 'running':
      return 'bg-blue-200 text-blue-700'
    case 'succeeded':
      return 'bg-green-200 text-green-700'
    case 'failed':
      return 'bg-red-200 text-red-700'
    case 'cancelled':
      return 'bg-yellow-200 text-yellow-700'
    default:
      return 'bg-gray-200 text-gray-700'
  }
}

export function formatProgressPercent(processedAtoms: number, totalAtoms: number): number {
  if (totalAtoms <= 0) return 100
  return Math.min(100, Math.round((processedAtoms / totalAtoms) * 100))
}
