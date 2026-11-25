import { describe, expect, it } from 'vitest';
import {
  GUARD_DATASET,
  HARNESS_DATASET,
  MEMORY_DATASET,
  TOOLS_DATASET,
  VOICE_DATASET,
} from '../src/datasets/index.js';

describe('curated evaluation datasets integrity', () => {
  it('provides rich non-empty datasets across all 5 suites with unique IDs', () => {
    expect(TOOLS_DATASET.length).toBeGreaterThanOrEqual(10);
    expect(HARNESS_DATASET.length).toBeGreaterThanOrEqual(10);
    expect(MEMORY_DATASET.length).toBeGreaterThanOrEqual(10);
    expect(GUARD_DATASET.length).toBeGreaterThanOrEqual(12);
    expect(VOICE_DATASET.length).toBeGreaterThanOrEqual(9);

    const allIds = [
      ...TOOLS_DATASET.map((c) => c.id),
      ...HARNESS_DATASET.map((c) => c.id),
      ...MEMORY_DATASET.map((c) => c.id),
      ...GUARD_DATASET.map((c) => c.id),
      ...VOICE_DATASET.map((c) => c.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('covers all required sub-categories and attack vectors', () => {
    expect(new Set(TOOLS_DATASET.map((c) => c.kind))).toEqual(
      new Set(['aom_compression', 'schema_validation', 'sandbox', 'multi_hop']),
    );
    expect(new Set(HARNESS_DATASET.map((c) => c.kind))).toEqual(
      new Set(['compaction', 'prefix_reuse', 'malformed_json', 'abort']),
    );
    expect(new Set(MEMORY_DATASET.map((c) => c.kind))).toEqual(
      new Set(['retrieval', 'superseding', 'temporal_decay', 'sensitive_domain']),
    );
    expect(new Set(GUARD_DATASET.map((c) => c.vector))).toEqual(
      new Set([
        'hidden-css',
        'unicode-smuggling',
        'svg-foreign-text',
        'hashjack',
        'fake-tool-tag',
        'lethal-trifecta',
        'benign',
      ]),
    );
    expect(new Set(VOICE_DATASET.map((c) => c.kind))).toEqual(
      new Set(['sentence_chunking', 'vad_onset', 'barge_in']),
    );
  });
});
