import type { ConcreteSuiteName, EvalCaseResult } from '../contracts.js';
import { clamp01, roundMetric } from '../metrics.js';

export interface SuiteRunOutput {
  suite: ConcreteSuiteName;
  cases: EvalCaseResult[];
  suiteMetrics: Record<string, number>;
  aggregateScore: number;
}

export async function measureAsync<T>(fn: () => Promise<T> | T): Promise<{ result: T; latencyMs: number }> {
  const start = performance.now();
  const result = await fn();
  const latencyMs = roundMetric(performance.now() - start, 3);
  return { result, latencyMs };
}

export function makeCaseResult(params: {
  id: string;
  suite: ConcreteSuiteName;
  passed: boolean;
  score: number;
  latencyMs: number;
  metrics: Record<string, number | boolean | string>;
  error?: string;
}): EvalCaseResult {
  const base: EvalCaseResult = {
    id: params.id,
    suite: params.suite,
    passed: params.passed,
    score: roundMetric(clamp01(params.score), 4),
    latencyMs: roundMetric(Math.max(0, params.latencyMs), 3),
    metrics: params.metrics,
  };
  if (params.error !== undefined) {
    base.error = params.error;
  }
  return base;
}
