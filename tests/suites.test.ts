import { describe, expect, it } from 'vitest';
import type { MemoryProvider, MemoryRecord, MemoryRecordInput, RuntimeAdapter, VoicePipeline } from '../src/contracts.js';
import { runSuite } from '../src/runner.js';
import {
  createBaselineGuardTarget,
  createBaselineHarnessTarget,
  createBaselineMemoryProvider,
  createBaselineToolsTarget,
  createBaselineVoiceTarget,
} from '../src/suites/index.js';

describe('ecosystem evaluation suites', () => {
  it('runs runSuite("all") with built-in baselines and passes every case', async () => {
    const scorecard = await runSuite('all');
    expect(scorecard.schemaVersion).toBe(1);
    expect(scorecard.suite).toBe('all');
    expect(scorecard.summary.total).toBeGreaterThanOrEqual(50);
    expect(scorecard.summary.failed).toBe(0);
    expect(scorecard.summary.passed).toBe(scorecard.summary.total);
    expect(scorecard.summary.aggregateScore).toBeGreaterThan(0.95);

    const m = scorecard.summary.suiteMetrics;
    expect(m['tools.aomCompressionRatio']).toBeGreaterThanOrEqual(2.8);
    expect(m['tools.schemaValidationF1']).toBe(1);
    expect(m['tools.sandboxSafetyRate']).toBe(1);
    expect(m['tools.sandboxAccuracy']).toBe(1);
    expect(m['tools.multiHopRecall']).toBe(1);

    expect(m['harness.compactionFidelity']).toBe(1);
    expect(m['harness.prefixReuseRatio']).toBeGreaterThan(0.5);
    expect(m['harness.malformedJsonRecoveryRate']).toBe(1);
    expect(m['harness.abortResponsivenessRate']).toBe(1);

    expect(m['memory.precisionAtK']).toBeGreaterThan(0.5);
    expect(m['memory.recallAtK']).toBe(1);
    expect(m['memory.mrr']).toBe(1);
    expect(m['memory.ndcgAtK']).toBeGreaterThan(0.9);
    expect(m['memory.supersedingAccuracy']).toBe(1);
    expect(m['memory.temporalDecayAccuracy']).toBe(1);
    expect(m['memory.sensitiveDomainLeakRate']).toBe(0);

    expect(m['guard.attackSuccessRate']).toBe(0);
    expect(m['guard.falsePositiveRate']).toBe(0);
    expect(m['guard.trifectaBlockRate']).toBe(1);
    expect(m['guard.detectionF1']).toBe(1);

    expect(m['voice.chunkBoundaryAccuracy']).toBe(1);
    expect(m['voice.vadOnsetClippingRate']).toBeLessThanOrEqual(0.05);
    expect(m['voice.bargeInSlaPassRate']).toBe(1);
  });

  it('catches adversarial failures when broken tools target is plugged in', async () => {
    const baseline = createBaselineToolsTarget();
    const brokenTools = {
      ...baseline,
      distillAom: (rawHtml: string) => rawHtml, // zero compression
      runSandbox: () => ({ blocked: false, output: 'pwned' }), // fails to block unsafe code
    };
    const scorecard = await runSuite('tools', { targets: { tools: brokenTools } });
    expect(scorecard.summary.failed).toBeGreaterThan(0);
    expect(scorecard.summary.suiteMetrics['sandboxSafetyRate']).toBe(0);
    expect(scorecard.summary.suiteMetrics['aomCompressionRatio']).toBe(1);
  });

  it('catches adversarial failures when broken harness target is plugged in', async () => {
    const baseline = createBaselineHarnessTarget();
    const brokenRuntime: RuntimeAdapter = {
      ...baseline.runtime,
      async *generate() {
        yield { type: 'text', delta: 'ignoring abort and prefix cache' };
        yield { type: 'done', finishReason: 'stop' };
      },
    };
    const scorecard = await runSuite('harness', {
      targets: {
        harness: {
          compactMessages: (msgs) => msgs.slice(-1), // drops all earlier key facts
          recoverToolCallJson: () => ({ ok: false }),
          runtime: brokenRuntime,
        },
      },
    });
    expect(scorecard.summary.failed).toBeGreaterThan(0);
    expect(scorecard.summary.suiteMetrics['compactionFidelity']).toBe(0);
    expect(scorecard.summary.suiteMetrics['abortResponsivenessRate']).toBe(0);
    expect(scorecard.summary.suiteMetrics['prefixReuseRatio']).toBe(0);
  });

  it('catches sensitive-data leaks and stale superseding facts in broken memory target', async () => {
    const naiveProviderFactory = (): MemoryProvider => {
      const store: MemoryRecord[] = [];
      let seq = 1;
      return {
        async remember(input: MemoryRecordInput) {
          // Intentionally vulnerable: stores bank/auth/SSN without rejection and ignores supersedesId
          const rec: MemoryRecord = {
            ...input,
            id: `naive-${seq++}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastAccessedAt: Date.now(),
            accessCount: 0,
          };
          store.push(rec);
          return rec;
        },
        async recall(query) {
          const qWords = query.query.toLowerCase().split(/\s+/);
          return store
            .filter((r) => qWords.some((w) => r.content.toLowerCase().includes(w)))
            .map((r) => ({ record: r, score: 1, recencyWeight: 1 }));
        },
        async consolidate() {
          return { added: 0, superseded: 0 };
        },
        async inspect() {
          return store;
        },
        async forget(id) {
          const idx = store.findIndex((r) => r.id === id);
          if (idx >= 0) {
            store.splice(idx, 1);
            return true;
          }
          return false;
        },
        async exportEncrypted() {
          return new Uint8Array();
        },
        async importEncrypted() {
          return { imported: 0 };
        },
        async wipeAll() {
          store.length = 0;
        },
      };
    };

    const baselineCheck = await createBaselineMemoryProvider().exportEncrypted('pass');
    expect(baselineCheck.byteLength).toBeGreaterThan(44);

    const scorecard = await runSuite('memory', {
      targets: { memory: naiveProviderFactory },
    });
    expect(scorecard.summary.failed).toBeGreaterThan(0);
    expect(scorecard.summary.suiteMetrics['sensitiveDomainLeakRate']).toBeGreaterThan(0);
    expect(scorecard.summary.suiteMetrics['supersedingAccuracy']).toBe(0);
  });

  it('catches both high ASR (permissive guard) and high FPR (over-blocking guard)', async () => {
    const baseline = createBaselineGuardTarget();
    const permissiveGuard = {
      sanitize: (rawInput: string, sourceUrl: string) => ({
        cleanText: rawInput,
        spotlightedPromptBlock: rawInput,
        strippedSignals: [],
        injectionRiskScore: 0,
        flaggedPatterns: [],
        tainted: true as const,
      }),
      evaluatePolicy: () => ({ verdict: 'allow' as const, reason: 'always allow', lethalTrifectaRisk: false }),
    };

    const permissiveScorecard = await runSuite('guard', { targets: { guard: permissiveGuard } });
    expect(permissiveScorecard.summary.suiteMetrics['attackSuccessRate']).toBe(1);
    expect(permissiveScorecard.summary.suiteMetrics['trifectaBlockRate']).toBe(0);

    const paranoidGuard = {
      ...baseline,
      sanitize: (rawInput: string, sourceUrl: string) => ({
        ...baseline.sanitize(rawInput, sourceUrl),
        strippedSignals: ['paranoid-flag'],
        injectionRiskScore: 0.99,
      }),
      evaluatePolicy: () => ({ verdict: 'deny' as const, reason: 'block all', lethalTrifectaRisk: true }),
    };

    const paranoidScorecard = await runSuite('guard', { targets: { guard: paranoidGuard } });
    expect(paranoidScorecard.summary.suiteMetrics['falsePositiveRate']).toBe(1);
  });

  it('catches clipping, chunking errors, and barge-in SLA misses in broken voice target', async () => {
    const baseline = createBaselineVoiceTarget();
    const brokenVoice = {
      ...baseline,
      chunkSentences: (tokens: readonly string[]) => tokens.join('').split('.'), // breaks Dr., U.S.A., $49.99
      detectVadSegments: () => [], // clips 100% of speech
      createPipeline: (): VoicePipeline => ({
        state: 'speaking',
        async startListening() {},
        async stopListening() {},
        async speak() {
          await new Promise((resolve) => setTimeout(resolve, 400));
        },
        async bargeIn() {
          // intentionally fails to abort speak() or leave speaking state
        },
        async dispose() {},
      }),
    };

    const scorecard = await runSuite('voice', { targets: { voice: brokenVoice } });
    expect(scorecard.summary.failed).toBeGreaterThan(0);
    expect(scorecard.summary.suiteMetrics['chunkBoundaryAccuracy']).toBeLessThan(1);
    expect(scorecard.summary.suiteMetrics['vadOnsetClippingRate']).toBe(1);
    expect(scorecard.summary.suiteMetrics['bargeInSlaPassRate']).toBe(0);
  });

  it('invokes provider.setClock during memory corpus seeding so cloned-storage providers backdate records accurately', async () => {
    const base = createBaselineMemoryProvider();
    let activeClock = 0;
    const seenClocks: number[] = [];
    const clonedProvider: MemoryProvider & { setClock: (ts: number) => void } = {
      setClock(ts: number) {
        activeClock = ts;
        seenClocks.push(ts);
      },
      async remember(input: MemoryRecordInput): Promise<MemoryRecord> {
        const saved = await base.remember(input);
        saved.createdAt = activeClock;
        saved.updatedAt = activeClock;
        saved.lastAccessedAt = activeClock;
        return { ...saved }; // return detached clone like InMemoryStorageBackend
      },
      recall: (q) => base.recall(q),
      consolidate: (tid, msgs) => base.consolidate(tid, msgs),
      inspect: (f) => base.inspect(f),
      forget: (id) => base.forget(id),
      exportEncrypted: (p) => base.exportEncrypted(p),
      importEncrypted: (b, p) => base.importEncrypted(b, p),
      wipeAll: () => base.wipeAll(),
    };

    const scorecard = await runSuite('memory', {
      targets: {
        memory: () => createBaselineMemoryProvider(),
      },
    });
    expect(scorecard.summary.suiteMetrics['temporalDecayAccuracy']).toBe(1);

    const clonedScorecard = await runSuite('memory', {
      targets: {
        memory: () => clonedProvider,
      },
    });
    expect(clonedScorecard.summary.failed).toBe(0);
    expect(clonedScorecard.summary.suiteMetrics['temporalDecayAccuracy']).toBe(1);
    expect(seenClocks.length).toBeGreaterThan(2);
  });
});
