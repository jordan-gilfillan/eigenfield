/**
 * Budget Queries — Calendar-Day Spend
 *
 * Queries actual spend from the database for the current UTC calendar day.
 * Combines Job (summarize) and ClassifyRun (classify) spend.
 */

import { prisma } from '../db'

/**
 * Returns the total USD spent on LLM calls during the given UTC calendar day.
 *
 * Sums costUsd from:
 * - Job records with finishedAt in [startOfDay, endOfDay) UTC
 * - ClassifyRun records with finishedAt in [startOfDay, endOfDay) UTC
 *
 * @param nowUtc - Reference time for the day boundary (default: current time)
 */
export async function getCalendarDaySpendUsd(nowUtc: Date = new Date()): Promise<number> {
  const startOfDay = new Date(Date.UTC(
    nowUtc.getUTCFullYear(),
    nowUtc.getUTCMonth(),
    nowUtc.getUTCDate(),
    0, 0, 0, 0
  ))
  const endOfDay = new Date(Date.UTC(
    nowUtc.getUTCFullYear(),
    nowUtc.getUTCMonth(),
    nowUtc.getUTCDate() + 1,
    0, 0, 0, 0
  ))

  const [jobAgg, classifyAgg] = await Promise.all([
    prisma.job.aggregate({
      where: {
        finishedAt: { gte: startOfDay, lt: endOfDay },
      },
      _sum: { costUsd: true },
    }),
    prisma.classifyRun.aggregate({
      where: {
        finishedAt: { gte: startOfDay, lt: endOfDay },
      },
      _sum: { costUsd: true },
    }),
  ])

  return (jobAgg._sum.costUsd ?? 0) + (classifyAgg._sum.costUsd ?? 0)
}
