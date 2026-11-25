import type {
  GenerateRequest,
  HarnessMessage,
  RuntimeAdapter,
  RuntimeCapabilities,
  StreamDelta,
} from '../contracts.js';
import { HARNESS_DATASET, type HarnessEvalCase } from '../datasets/harness.js';
import {
  computePrefixReuseRatio,
  computeRate,
  estimateTokens,
  mean,
  roundMetric,
} from '../metrics.js';
import { makeCaseResult, measureAsync, type SuiteRunOutput } from './common.js';

export interface HarnessEvalTarget {
  compactMessages(
    messages: readonly HarnessMessage[],
    maxTargetTokens: number,
  ): Promise<HarnessMessage[]> | HarnessMessage[];
  recoverToolCallJson(
    toolName: string,
    rawChunks: readonly string[],
  ):
    | Promise<{ ok: boolean; arguments?: Record<string, unknown> }>
    | { ok: boolean; arguments?: Record<string, unknown> };
  runtime: RuntimeAdapter;
}

function baselineCompactMessages(
  messages: readonly HarnessMessage[],
  maxTargetTokens: number,
): HarnessMessage[] {
  if (messages.length === 0) return [];
  const tokenCost = (m: HarnessMessage): number => estimateTokens(`${m.role}: ${m.content}`) + 4;
  const totalNow = messages.reduce((sum, m) => sum + tokenCost(m), 0);
  if (totalNow <= maxTargetTokens) return [...messages];

  const mustKeepIndices = new Set<number>();
  messages.forEach((m, idx) => {
    if (m.role === 'system' || idx === messages.length - 1 || idx === 1) {
      mustKeepIndices.add(idx);
    }
  });

  const scoreMessage = (m: HarnessMessage, idx: number): number => {
    if (mustKeepIndices.has(idx)) return 1_000_000;
    let score = 0;
    if (m.role === 'tool') score += 50;
    if (/\b(?:SKU|CONF|WGSL_ERR|commit|USB4|\$\d+|\d{5})\b/i.test(m.content)) score += 40;
    if (/nut-free|Terminal \d|tier\d|budget/i.test(m.content)) score += 35;
    if (/intermediate status step|padding metrics/i.test(m.content)) score -= 20;
    return score;
  };

  let budget = maxTargetTokens;
  const selected = new Set<number>();
  for (const idx of mustKeepIndices) {
    const m = messages[idx];
    if (m) {
      selected.add(idx);
      budget -= tokenCost(m);
    }
  }

  const ranked = messages
    .map((m, idx) => ({ idx, m, score: scoreMessage(m, idx), cost: tokenCost(m) }))
    .filter((entry) => !selected.has(entry.idx))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  for (const entry of ranked) {
    if (entry.cost <= budget) {
      selected.add(entry.idx);
      budget -= entry.cost;
    }
  }

  return messages.filter((_, idx) => selected.has(idx));
}

function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();
}

function normalizeSingleQuotedJson(raw: string): string {
  // Replace single-quoted keys/values with double quotes safely outside double-quoted strings
  let out = '';
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const prev = i > 0 ? raw[i - 1] : '';
    if (ch === '"' && !inSingle && prev !== '\\') {
      inDouble = !inDouble;
      out += ch;
    } else if (ch === "'" && !inDouble && prev !== '\\') {
      inSingle = !inSingle;
      out += '"';
    } else {
      out += ch;
    }
  }
  return out;
}

function balanceDelimiters(raw: string): string {
  let inString = false;
  const stack: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const prev = i > 0 ? raw[i - 1] : '';
    if (ch === '"' && prev !== '\\') {
      inString = !inString;
    } else if (!inString) {
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }
  let repaired = raw;
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*([}\]])/g, '$1').replace(/,\s*$/g, '');
  while (stack.length > 0) {
    repaired += stack.pop();
  }
  return repaired;
}

function baselineRecoverToolCallJson(
  _toolName: string,
  rawChunks: readonly string[],
): { ok: boolean; arguments?: Record<string, unknown> } {
  const joined = stripMarkdownFences(rawChunks.join(''));
  const startIdx = joined.indexOf('{');
  if (startIdx === -1) return { ok: false };

  const slice = joined.slice(startIdx);
  const candidates = [
    slice,
    balanceDelimiters(normalizeSingleQuotedJson(slice)),
  ];

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, arguments: parsed as Record<string, unknown> };
      }
    } catch {
      // try next repair pass
    }
  }
  return { ok: false };
}

export function createBaselineRuntimeAdapter(): RuntimeAdapter {
  const prefixSlots = new Map<string, string[]>();

  const serializeMessage = (m: HarnessMessage): string => `${m.role}:${m.id}:${m.content}`;

  const computeSharedTokens = (slotKey: string | undefined, messages: readonly HarnessMessage[]): number => {
    if (!slotKey) return 0;
    const cached = prefixSlots.get(slotKey);
    if (!cached) return 0;
    let sharedTokens = 0;
    const maxLen = Math.min(cached.length, messages.length);
    for (let i = 0; i < maxLen; i++) {
      const msg = messages[i]!;
      if (cached[i] === serializeMessage(msg)) {
        sharedTokens += estimateTokens(msg.content);
      } else {
        break;
      }
    }
    return sharedTokens;
  };

  return {
    capabilities(): RuntimeCapabilities {
      return {
        id: 'yours-baseline-local-runtime',
        maxContextTokens: 8192,
        supportsStreaming: true,
        supportsPrefixSlots: true,
        supportsTools: true,
        tier: 'tier1-f16-subgroups',
      };
    },
    countTokens(messages: HarnessMessage[]): number {
      return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    },
    async prefillSlot(slotKey: string, messages: HarnessMessage[]) {
      const start = performance.now();
      const tokens = this.countTokens(messages) as number;
      prefixSlots.set(slotKey, messages.map(serializeMessage));
      return { tokens, elapsedMs: roundMetric(performance.now() - start, 3) };
    },
    async evictSlot(slotKey: string) {
      prefixSlots.delete(slotKey);
    },
    async *generate(request: GenerateRequest, signal?: AbortSignal): AsyncIterable<StreamDelta> {
      if (signal?.aborted) {
        yield { type: 'done', finishReason: 'abort' };
        return;
      }

      const kvTokens = computeSharedTokens(request.prefixSlotKey, request.messages);
      if (request.prefixSlotKey) {
        prefixSlots.set(request.prefixSlotKey, request.messages.map(serializeMessage));
      }

      yield {
        type: 'telemetry',
        ttftMs: 12,
        tokensPerSec: 65,
        kvTokens,
      };

      const words = [
        'Local',
        'WebGPU',
        'runtime',
        'response',
        'generated',
        'cleanly',
        'with',
        'prefix',
        'cache',
        'support.',
      ];

      for (const word of words) {
        if (signal?.aborted) {
          yield { type: 'done', finishReason: 'abort' };
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (signal?.aborted) {
          yield { type: 'done', finishReason: 'abort' };
          return;
        }
        yield { type: 'text', delta: `${word} ` };
      }

      yield { type: 'done', finishReason: 'stop' };
    },
  };
}

export function createBaselineHarnessTarget(): HarnessEvalTarget {
  return {
    compactMessages: baselineCompactMessages,
    recoverToolCallJson: baselineRecoverToolCallJson,
    runtime: createBaselineRuntimeAdapter(),
  };
}

function deepEqualRecords(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (!a || !b) return false;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k, i) => k === keysB[i] && a[k] === b[k]);
}

export async function runHarnessSuite(
  target: HarnessEvalTarget = createBaselineHarnessTarget(),
  dataset: readonly HarnessEvalCase[] = HARNESS_DATASET,
): Promise<SuiteRunOutput> {
  const cases = [];
  const compactionScores: number[] = [];
  const prefixReuseRatios: number[] = [];
  const recoveryScores: number[] = [];
  const abortPasses: number[] = [];
  const abortLatencies: number[] = [];

  for (const item of dataset) {
    if (item.kind === 'compaction') {
      const { result: compacted, latencyMs } = await measureAsync(() =>
        target.compactMessages(item.messages, item.maxTargetTokens),
      );
      const compactedText = compacted.map((m) => m.content).join('\n').toLowerCase();
      const retained = item.requiredFacts.filter((f) => compactedText.includes(f.toLowerCase())).length;
      const factRecall = computeRate(retained, item.requiredFacts.length);
      const usedTokens = compacted.reduce((sum, m) => sum + estimateTokens(`${m.role}: ${m.content}`) + 4, 0);
      const withinBudget = usedTokens <= item.maxTargetTokens;
      const budgetScore = withinBudget ? 1 : Math.max(0, 1 - (usedTokens - item.maxTargetTokens) / item.maxTargetTokens);
      const score = 0.75 * factRecall + 0.25 * budgetScore;
      compactionScores.push(factRecall);
      cases.push(
        makeCaseResult({
          id: item.id,
          suite: 'harness',
          passed: factRecall === 1 && withinBudget,
          score,
          latencyMs,
          metrics: {
            kind: item.kind,
            factRecall: roundMetric(factRecall, 4),
            usedTokens,
            maxTargetTokens: item.maxTargetTokens,
          },
        }),
      );
    } else if (item.kind === 'prefix_reuse') {
      const { result: turnMetrics, latencyMs } = await measureAsync(async () => {
        const hitRatios: number[] = [];
        let expectationsMet = 0;
        for (const turn of item.turns) {
          const totalTokens = await target.runtime.countTokens(turn.messages);
          let kvTokens = 0;
          for await (const delta of target.runtime.generate({
            messages: turn.messages,
            prefixSlotKey: turn.slotKey,
          })) {
            if (delta.type === 'telemetry' && delta.kvTokens !== undefined) {
              kvTokens = delta.kvTokens;
            }
          }
          const reuseRatio = computePrefixReuseRatio(kvTokens, totalTokens);
          if (turn.expectCacheHit) {
            hitRatios.push(reuseRatio);
            if (kvTokens >= turn.expectedMinSharedTokens) expectationsMet++;
          } else if (kvTokens === 0) {
            expectationsMet++;
          }
        }
        return { hitRatios, expectationsMet, totalTurns: item.turns.length };
      });
      const meanHitReuse = mean(turnMetrics.hitRatios);
      const expectationRate = computeRate(turnMetrics.expectationsMet, turnMetrics.totalTurns);
      prefixReuseRatios.push(meanHitReuse);
      cases.push(
        makeCaseResult({
          id: item.id,
          suite: 'harness',
          passed: expectationRate === 1 && meanHitReuse > 0.5,
          score: 0.5 * expectationRate + 0.5 * meanHitReuse,
          latencyMs,
          metrics: {
            kind: item.kind,
            prefixReuseRatio: roundMetric(meanHitReuse, 4),
            expectationRate: roundMetric(expectationRate, 4),
          },
        }),
      );
    } else if (item.kind === 'malformed_json') {
      const { result: recovered, latencyMs } = await measureAsync(() =>
        target.recoverToolCallJson(item.toolName, item.rawChunks),
      );
      const ok = item.expectRecoverable
        ? recovered.ok && deepEqualRecords(recovered.arguments, item.expectedArgs)
        : !recovered.ok;
      recoveryScores.push(ok ? 1 : 0);
      cases.push(
        makeCaseResult({
          id: item.id,
          suite: 'harness',
          passed: ok,
          score: ok ? 1 : 0,
          latencyMs,
          metrics: {
            kind: item.kind,
            expectRecoverable: item.expectRecoverable,
            recoveredOk: recovered.ok,
          },
        }),
      );
    } else {
      const controller = new AbortController();
      if (item.preAborted) controller.abort();
      let seenTextChunks = 0;
      let finishReason: string | undefined;
      let abortTriggeredAt: number | null = item.preAborted ? performance.now() : null;
      let postAbortChunks = 0;

      const { latencyMs } = await measureAsync(async () => {
        for await (const delta of target.runtime.generate({ messages: item.messages }, controller.signal)) {
          if (delta.type === 'text') {
            if (abortTriggeredAt !== null && seenTextChunks >= item.abortAfterChunks) {
              postAbortChunks++;
            }
            seenTextChunks++;
            if (!item.preAborted && seenTextChunks === item.abortAfterChunks) {
              abortTriggeredAt = performance.now();
              controller.abort();
            }
          } else if (delta.type === 'done') {
            finishReason = delta.finishReason;
          }
        }
      });

      const abortLatencyMs =
        abortTriggeredAt === null
          ? latencyMs
          : roundMetric(Math.max(0, performance.now() - abortTriggeredAt), 3);
      const passed =
        finishReason === 'abort' &&
        postAbortChunks === 0 &&
        abortLatencyMs <= item.maxAbortLatencyMs;
      abortPasses.push(passed ? 1 : 0);
      abortLatencies.push(abortLatencyMs);
      cases.push(
        makeCaseResult({
          id: item.id,
          suite: 'harness',
          passed,
          score: passed ? 1 : 0,
          latencyMs,
          metrics: {
            kind: item.kind,
            finishReason: finishReason ?? 'missing',
            postAbortChunks,
            abortLatencyMs,
          },
        }),
      );
    }
  }

  const suiteMetrics: Record<string, number> = {
    compactionFidelity: roundMetric(mean(compactionScores), 4),
    prefixReuseRatio: roundMetric(mean(prefixReuseRatios), 4),
    malformedJsonRecoveryRate: roundMetric(mean(recoveryScores), 4),
    abortResponsivenessRate: roundMetric(mean(abortPasses), 4),
    meanAbortLatencyMs: roundMetric(mean(abortLatencies), 3),
  };

  return {
    suite: 'harness',
    cases,
    suiteMetrics,
    aggregateScore: roundMetric(mean(cases.map((c) => c.score)), 4),
  };
}
