/**
 * Export filesystem writer
 *
 * Takes an ExportTree (Map<path, content>) and writes it to a directory on disk.
 * Pure I/O layer — no DB, no rendering logic.
 *
 * Spec reference: §14 (Git Export)
 */

import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import type { ExportTree } from './types'

export const EXPORT_BASE_DIR = join(process.cwd(), 'exports')

export class ExportPathValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportPathValidationError'
  }
}

function isWithinBase(pathToCheck: string, basePath: string): boolean {
  if (pathToCheck === basePath) return true
  const basePrefix = basePath.endsWith(sep) ? basePath : `${basePath}${sep}`
  return pathToCheck.startsWith(basePrefix)
}

function hasTraversalSegment(normalizedPath: string): boolean {
  const segments = normalizedPath.split(/[\\/]+/).filter(Boolean)
  return segments.includes('..')
}

/**
 * Resolves a user-provided export output directory to a sandboxed absolute path.
 *
 * Rules:
 * - input must be non-empty string
 * - input must be relative (not absolute)
 * - normalized path must not contain ".." traversal segments
 * - final path must remain under EXPORT_BASE_DIR (including realpath containment)
 */
export async function resolveExportOutputDir(outputDir: string): Promise<string> {
  const trimmed = outputDir.trim()
  if (!trimmed) {
    throw new ExportPathValidationError('outputDir must be a non-empty string')
  }

  if (isAbsolute(trimmed)) {
    throw new ExportPathValidationError('outputDir must be a relative path under exports/')
  }

  const normalized = normalize(trimmed)
  if (normalized === '' || normalized === '.') {
    throw new ExportPathValidationError('outputDir must be a subdirectory under exports/')
  }
  if (hasTraversalSegment(normalized)) {
    throw new ExportPathValidationError('outputDir must not contain path traversal ("..")')
  }

  const resolvedBase = resolve(EXPORT_BASE_DIR)
  const resolvedOutput = resolve(resolvedBase, normalized)

  if (!isWithinBase(resolvedOutput, resolvedBase)) {
    throw new ExportPathValidationError('outputDir resolves outside the export sandbox')
  }

  await mkdir(resolvedBase, { recursive: true })
  await mkdir(resolvedOutput, { recursive: true })

  const realBase = await realpath(resolvedBase)
  const realOutput = await realpath(resolvedOutput)

  if (!isWithinBase(realOutput, realBase)) {
    throw new ExportPathValidationError('outputDir escapes the export sandbox via symlink')
  }

  return resolvedOutput
}

/**
 * Writes an ExportTree to disk.
 *
 * - Creates intermediate directories as needed.
 * - Overwrites existing files (idempotent re-export).
 * - Files are written as UTF-8.
 *
 * @param tree - Map of relative paths to file content
 * @param outputDir - Absolute path to the output directory
 */
export async function writeExportTree(
  tree: ExportTree,
  outputDir: string,
): Promise<void> {
  for (const [relativePath, content] of tree) {
    const fullPath = join(outputDir, relativePath)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf-8')
  }
}
