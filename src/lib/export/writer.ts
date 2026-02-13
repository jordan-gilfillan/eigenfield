/**
 * Export filesystem writer
 *
 * Takes an ExportTree (Map<path, content>) and writes it to a directory on disk.
 * Pure I/O layer — no DB, no rendering logic.
 *
 * Spec reference: §14 (Git Export)
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type { ExportTree } from './types'

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
