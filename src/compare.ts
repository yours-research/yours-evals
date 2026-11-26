import type { EvalScorecard } from './contracts.js';
import { roundMetric } from './metrics.js';

export type MetricDirection = 'higher' | 'lower';

export interface CompareOptions {
  maxLatencyRegressionMs?: number;
  metricDirections?: Record<string, MetricDirection>;
}

export interface MetricDelta {
  metric: string;
  direction: MetricDirection;
  baseline: number;
  current: number;
  delta: number; // current - baseline
  regressionAmount: number; // positive means worse than baseline
  threshold: number;
  regressed: boolean;
}

export interface ScorecardComparisonResult {
  passed: boolean;
  maxRegression: number;
  maxLatencyRegressionMs: number;
  regressions: MetricDelta[];
  improvements: MetricDelta[];
  deltas: MetricDelta[];
}

const LOWER_IS_BETTER_SUFFIXES = [
  'attackSuccessRate',
  'falsePositiveRate',
  'sensitiveDomainLeakRate',
  'vadOnsetClippingRate',
];

function inferDirection(
  metricName: string,
  overrides?: Record<string, MetricDirection>,
): { direction: MetricDirection; isLatency: boolean } {
  const shortName = metricName.includes('.')
    ? metricName.slice(metricName.lastIndexOf('.') + 1)
    : metricName;
  const override = overrides?.[metricName] ?? overrides?.[shortName];
  const isLatency =
    shortName.endsWith('LatencyMs') ||
    shortName.endsWith('TeardownMs') ||
    shortName.endsWith('TtftMs') ||
    shortName.endsWith('WaitMs');
  if (override) {
    return { direction: override, isLatency };
  }
  if (isLatency || LOWER_IS_BETTER_SUFFIXES.includes(shortName)) {
    return { direction: 'lower', isLatency };
  }
  return { direction: 'higher', isLatency };
}

function evaluateMetricDelta(
  metric: string,
  baseline: number,
  current: number,
  maxRegression: number,
  maxLatencyRegressionMs: number,
  overrides?: Record<string, MetricDirection>,
): MetricDelta {
  const { direction, isLatency } = inferDirection(metric, overrides);
  const delta = roundMetric(current - baseline, 4);
  const regressionAmount = roundMetric(
    direction === 'higher' ? baseline - current : current - baseline,
    4,
  );
  const threshold = isLatency ? maxLatencyRegressionMs : maxRegression;
  const regressed = regressionAmount > threshold;

  return {
    metric,
    direction,
    baseline: roundMetric(baseline, 4),
    current: roundMetric(current, 4),
    delta,
    regressionAmount,
    threshold,
    regressed,
  };
}

export function compareScorecards(
  baseline: EvalScorecard,
  current: EvalScorecard,
  maxRegression = 0.02,
  options: CompareOptions = {},
): ScorecardComparisonResult {
  const maxLatencyRegressionMs = options.maxLatencyRegressionMs ?? 50;
  const deltas: MetricDelta[] = [];

  deltas.push(
    evaluateMetricDelta(
      'summary.aggregateScore',
      baseline.summary.aggregateScore,
      current.summary.aggregateScore,
      maxRegression,
      maxLatencyRegressionMs,
      options.metricDirections,
    ),
  );

  const metricKeys = new Set([
    ...Object.keys(baseline.summary.suiteMetrics),
    ...Object.keys(current.summary.suiteMetrics),
  ]);

  for (const key of Array.from(metricKeys).sort()) {
    const baseVal = baseline.summary.suiteMetrics[key];
    const currVal = current.summary.suiteMetrics[key];
    if (baseVal === undefined || currVal === undefined) {
      // Missing metric in current scorecard counts as regression if it existed in baseline
      if (baseVal !== undefined && currVal === undefined) {
        deltas.push({
          metric: key,
          direction: 'higher',
          baseline: baseVal,
          current: 0,
          delta: roundMetric(-baseVal, 4),
          regressionAmount: roundMetric(baseVal, 4),
          threshold: maxRegression,
          regressed: true,
        });
      }
      continue;
    }

    deltas.push(
      evaluateMetricDelta(
        key,
        baseVal,
        currVal,
        maxRegression,
        maxLatencyRegressionMs,
        options.metricDirections,
      ),
    );
  }

  const regressions = deltas.filter((d) => d.regressed);
  const improvements = deltas.filter((d) => !d.regressed && d.regressionAmount < -0.0001);

  return {
    passed: regressions.length === 0,
    maxRegression,
    maxLatencyRegressionMs,
    regressions,
    improvements,
    deltas,
  };
}
