import type { EvalScorecard } from './contracts.js';
import { roundMetric } from './metrics.js';

export type MetricDirection = 'higher' | 'lower';

export interface CompareOptions {
  maxLatencyRegressionMs?: number;
  /** Relative regression tolerance [0..1] for non-unit scale throughput metrics (default: 0.12 = 12%). */
  maxRelativeRegression?: number;
  /** Absolute percentage-point tolerance for jitter/jank *Pct metrics on a 0..100 scale (default: 2.0). */
  maxJankRegressionPct?: number;
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
  'jankPct',
  'freezePct',
  'errorCount',
  'popupWindowCount',
  'leakRate',
];

type MetricScaleKind = 'latency' | 'percentage' | 'throughput' | 'unit';

function inferMetricMeta(
  metricName: string,
  overrides?: Record<string, MetricDirection>,
): { direction: MetricDirection; isLatency: boolean; scale: MetricScaleKind } {
  const shortName = metricName.includes('.')
    ? metricName.slice(metricName.lastIndexOf('.') + 1)
    : metricName;
  const override = overrides?.[metricName] ?? overrides?.[shortName];
  const isLatency =
    shortName.endsWith('LatencyMs') ||
    shortName.endsWith('TeardownMs') ||
    shortName.endsWith('TtftMs') ||
    shortName.endsWith('WaitMs');
  const isPercentage = shortName.endsWith('Pct') && !shortName.endsWith('Rate');
  const isThroughput =
    shortName.endsWith('TokPerSec') ||
    shortName.endsWith('TokensPerSec') ||
    shortName.endsWith('Fps') ||
    shortName.endsWith('CompressionRatio');
  const scale: MetricScaleKind = isLatency
    ? 'latency'
    : isPercentage
      ? 'percentage'
      : isThroughput
        ? 'throughput'
        : 'unit';

  if (override) {
    return { direction: override, isLatency, scale };
  }
  if (isLatency || LOWER_IS_BETTER_SUFFIXES.includes(shortName)) {
    return { direction: 'lower', isLatency, scale };
  }
  return { direction: 'higher', isLatency, scale };
}

function evaluateMetricDelta(
  metric: string,
  baseline: number,
  current: number,
  maxRegression: number,
  maxLatencyRegressionMs: number,
  maxRelativeRegression: number,
  maxJankRegressionPct: number,
  overrides?: Record<string, MetricDirection>,
): MetricDelta {
  const { direction, scale } = inferMetricMeta(metric, overrides);
  const delta = roundMetric(current - baseline, 4);
  const regressionAmount = roundMetric(
    direction === 'higher' ? baseline - current : current - baseline,
    4,
  );
  let threshold = maxRegression;
  if (scale === 'latency') {
    threshold = maxLatencyRegressionMs;
  } else if (scale === 'percentage') {
    threshold = maxJankRegressionPct;
  } else if (scale === 'throughput') {
    threshold = roundMetric(Math.max(maxRegression, Math.abs(baseline) * maxRelativeRegression), 4);
  }
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
  const maxRelativeRegression = options.maxRelativeRegression ?? 0.12;
  const maxJankRegressionPct = options.maxJankRegressionPct ?? 2.0;
  const deltas: MetricDelta[] = [];

  deltas.push(
    evaluateMetricDelta(
      'summary.aggregateScore',
      baseline.summary.aggregateScore,
      current.summary.aggregateScore,
      maxRegression,
      maxLatencyRegressionMs,
      maxRelativeRegression,
      maxJankRegressionPct,
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
        maxRelativeRegression,
        maxJankRegressionPct,
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
