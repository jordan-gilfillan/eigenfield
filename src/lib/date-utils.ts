/**
 * Formats a Date as YYYY-MM-DD using UTC fields.
 * Avoids timezone shift on Prisma DATE columns.
 */
export function formatDate(d: Date): string {
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
