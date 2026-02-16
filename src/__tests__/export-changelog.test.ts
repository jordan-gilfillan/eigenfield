/**
 * Export v2 — changelog module tests
 *
 * Tests for stub function signatures.
 * Full implementation tests will be added in EPIC-083c.
 *
 * Spec reference: §14.14
 */

import { describe, it, expect } from 'vitest'
import { computeChangelog, renderChangelog } from '../lib/export/changelog'
import type { PreviousManifest, TopicData } from '../lib/export/types'

// ---------------------------------------------------------------------------
// Stub functions — verify they exist and throw (EPIC-083c will implement)
// ---------------------------------------------------------------------------

describe('changelog stub functions', () => {
  const stubPreviousManifest: PreviousManifest = {
    exportedAt: '2024-01-15T00:00:00.000Z',
    topics: {},
    topicVersion: 'topic_v1',
  }

  it('computeChangelog throws with implementation notice', () => {
    expect(() => computeChangelog([], stubPreviousManifest)).toThrow('not implemented')
  })

  it('renderChangelog throws with implementation notice', () => {
    expect(() =>
      renderChangelog(
        { newTopics: [], removedTopics: [], changedTopics: [], changeCount: 0 },
        '2024-01-20T00:00:00.000Z',
        '2024-01-15T00:00:00.000Z',
        'topic_v1',
      ),
    ).toThrow('not implemented')
  })
})
