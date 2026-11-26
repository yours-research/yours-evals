import { describe, expect, it } from 'vitest';
import { compareScorecards } from '../src/compare.js';
import type { EvalScorecard } from '../src/contracts.js';
import { formatScorecardJson } from '../src/reporters/json.js';
import { formatScorecardMarkdown } from '../src/reporters/markdown.js';
import { runSuite } from '../src/runner.js';

function cloneScorecard(sc: EvalScorecard): EvalScorecard {
  return JSON.parse(JSON.stringify(sc)) as EvalScorecard;
}

describe('baseline comparison gate and scorecard reporters', () => {
  it('passes when current matches or improves upon baseline within threshold', async () => {
    const baseline = await runSuite('all', { timestampIso: '2026-11-25T12:00:00.000Z' });
    const current = cloneScorecard(baseline);
    current.summary.suiteMetrics['tools.aomCompressionRatio'] =
      (baseline.summary.suiteMetrics['tools.aomCompressionRatio'] ?? 3) + 0.5;

    const diff = compareScorecards(baseline, current, 0.02);
    expect(diff.passed).toBe(true);
    expect(diff.regressions).toHaveLength(0);
    expect(diff.improvements.some((i) => i.metric === 'tools.aomCompressionRatio')).toBe(true);
  });

  it('fails cleanly when a higher-is-better metric drops beyond maxRegression', async () => {
    const baseline = await runSuite('memory');
    const current = cloneScorecard(baseline);
    current.summary.suiteMetrics['ndcgAtK'] = (baseline.summary.suiteMetrics['ndcgAtK'] ?? 1) - 0.08;

    const diff = compareScorecards(baseline, current, 0.02);
    expect(diff.passed).toBe(false);
    expect(diff.regressions.map((r) => r.metric)).toContain('ndcgAtK');
  });

  it('fails cleanly when a lower-is-better error rate (ASR/FPR/leak) increases beyond maxRegression', async () => {
    const baseline = await runSuite('guard');
    const current = cloneScorecard(baseline);
    current.summary.suiteMetrics['attackSuccessRate'] = 0.05;

    const diff = compareScorecards(baseline, current, 0.02);
    expect(diff.passed).toBe(false);
    expect(diff.regressions.map((r) => r.metric)).toContain('attackSuccessRate');
  });

  it('fails when latency exceeds maxLatencyRegressionMs or a baseline metric disappears', async () => {
    const baseline = await runSuite('voice');
    const current = cloneScorecard(baseline);
    current.summary.suiteMetrics['meanBargeInTeardownMs'] =
      (baseline.summary.suiteMetrics['meanBargeInTeardownMs'] ?? 5) + 120;
    delete current.summary.suiteMetrics['chunkBoundaryAccuracy'];

    const diff = compareScorecards(baseline, current, 0.02, { maxLatencyRegressionMs: 50 });
    expect(diff.passed).toBe(false);
    const regressedMetrics = diff.regressions.map((r) => r.metric);
    expect(regressedMetrics).toContain('meanBargeInTeardownMs');
    expect(regressedMetrics).toContain('chunkBoundaryAccuracy');
  });

  it('treats *TtftMs and *WaitMs metrics as lower-is-better latencies governed by maxLatencyRegressionMs', async () => {
    const baseline = await runSuite('voice');
    const current = cloneScorecard(baseline);
    baseline.summary.suiteMetrics['meanTtftMs'] = 250;
    baseline.summary.suiteMetrics['meanInterTurnWaitMs'] = 40;
    current.summary.suiteMetrics['meanTtftMs'] = 280; // +30ms (within 50ms threshold, above 0.02 ratio)
    current.summary.suiteMetrics['meanInterTurnWaitMs'] = 110; // +70ms (exceeds 50ms threshold)

    const diff = compareScorecards(baseline, current, 0.02, { maxLatencyRegressionMs: 50 });
    expect(diff.passed).toBe(false);
    expect(diff.regressions.map((r) => r.metric)).toEqual(['meanInterTurnWaitMs']);
    expect(diff.regressions[0]?.threshold).toBe(50);
  });

  it('formats valid JSON and GitHub-compatible Markdown scorecards', async () => {
    const baseline = await runSuite('guard');
    const current = cloneScorecard(baseline);
    current.summary.suiteMetrics['falsePositiveRate'] = 0.1;

    const diff = compareScorecards(baseline, current, 0.02);
    const json = formatScorecardJson(current);
    const parsed = JSON.parse(json) as EvalScorecard;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.suite).toBe('guard');

    const md = formatScorecardMarkdown(current, diff);
    expect(md).toContain('## @yours/evals Scorecard — `guard` (FAIL)');
    expect(md).toContain('### Suite Summary');
    expect(md).toContain('### Suite Metrics');
    expect(md).toContain('### Baseline Regression Gate (FAIL, maxRegression=0.02)');
    expect(md).toContain('`falsePositiveRate`');
    expect(md).toContain('<details>');
  });
});
