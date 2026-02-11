/**
 * Cost anomaly detection for Studio day sidebar.
 * Pure functions — no React, no side effects.
 */

interface JobCostInfo {
  status: string
  costUsd: number
}

/**
 * Compute the median cost from succeeded jobs with costUsd > 0.
 * Returns null if fewer than 3 eligible values (not meaningful).
 */
export function getMedianCost(jobs: JobCostInfo[]): number | null {
  const costs = jobs
    .filter((j) => j.status === 'succeeded' && j.costUsd > 0)
    .map((j) => j.costUsd)
    .sort((a, b) => a - b)

  if (costs.length < 3) return null

  const mid = Math.floor(costs.length / 2)
  return costs.length % 2 === 0
    ? (costs[mid - 1] + costs[mid]) / 2
    : costs[mid]
}

/**
 * Returns a Set of dayDate strings where costUsd > 2 * median.
 * Only badges succeeded days with costUsd > 0.
 */
export function getAnomalousDays(
  jobs: Array<JobCostInfo & { dayDate: string }>,
): Set<string> {
  const median = getMedianCost(jobs)
  if (median === null) return new Set()

  const threshold = 2 * median
  const result = new Set<string>()

  for (const job of jobs) {
    if (job.status === 'succeeded' && job.costUsd > threshold) {
      result.add(job.dayDate)
    }
  }

  return result
}
