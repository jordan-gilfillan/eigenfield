import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeExportTree } from '@/lib/export/writer'
import type { ExportTree } from '@/lib/export/types'

describe('writeExportTree', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'export-writer-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('writes all files from a tree', async () => {
    const tree: ExportTree = new Map([
      ['README.md', '# Journal Export\n'],
      ['views/timeline.md', '# Timeline\n'],
    ])

    await writeExportTree(tree, tempDir)

    const readme = await readFile(join(tempDir, 'README.md'), 'utf-8')
    expect(readme).toBe('# Journal Export\n')

    const timeline = await readFile(join(tempDir, 'views/timeline.md'), 'utf-8')
    expect(timeline).toBe('# Timeline\n')
  })

  it('creates intermediate directories', async () => {
    const tree: ExportTree = new Map([
      ['.journal-meta/manifest.json', '{"formatVersion":"export_v1"}\n'],
      ['views/2025-01-15.md', '---\ndate: "2025-01-15"\n---\n\nContent\n'],
    ])

    await writeExportTree(tree, tempDir)

    const manifest = await readFile(join(tempDir, '.journal-meta/manifest.json'), 'utf-8')
    expect(manifest).toBe('{"formatVersion":"export_v1"}\n')

    const metaStat = await stat(join(tempDir, '.journal-meta'))
    expect(metaStat.isDirectory()).toBe(true)
  })

  it('overwrites existing files (idempotent)', async () => {
    const tree1: ExportTree = new Map([
      ['README.md', 'version 1\n'],
    ])
    const tree2: ExportTree = new Map([
      ['README.md', 'version 2\n'],
    ])

    await writeExportTree(tree1, tempDir)
    const first = await readFile(join(tempDir, 'README.md'), 'utf-8')
    expect(first).toBe('version 1\n')

    await writeExportTree(tree2, tempDir)
    const second = await readFile(join(tempDir, 'README.md'), 'utf-8')
    expect(second).toBe('version 2\n')
  })

  it('writes empty tree without error', async () => {
    const tree: ExportTree = new Map()

    await writeExportTree(tree, tempDir)

    const entries = await readdir(tempDir)
    expect(entries).toHaveLength(0)
  })

  it('preserves UTF-8 content', async () => {
    const content = '# Journal\n\nToday I discussed café strategies and naïve Bayes.\n'
    const tree: ExportTree = new Map([
      ['views/2025-03-01.md', content],
    ])

    await writeExportTree(tree, tempDir)

    const result = await readFile(join(tempDir, 'views/2025-03-01.md'), 'utf-8')
    expect(result).toBe(content)
  })

  it('handles deeply nested paths', async () => {
    const tree: ExportTree = new Map([
      ['a/b/c/deep.txt', 'deep content\n'],
    ])

    await writeExportTree(tree, tempDir)

    const result = await readFile(join(tempDir, 'a/b/c/deep.txt'), 'utf-8')
    expect(result).toBe('deep content\n')
  })
})
