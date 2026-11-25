import type { ScorecardComparisonResult } from '../compare.js';
import type { ConcreteSuiteName, EvalScorecard } from '../contracts.js';

function formatStatusBadge(passed: boolean): string {
  return passed ? 'PASS' : 'FAIL';
}

function formatNumber(val: number): string {
  return Number.isInteger(val) ? String(val) : val.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatScorecardMarkdown(
  scorecard: EvalScorecard,
  comparison?: ScorecardComparisonResult,
): string {
  const { summary, cases } = scorecard;
  const overallPass = summary.failed === 0 && (comparison ? comparison.passed : true);

  const lines: string[] = [
    `## @yours/evals Scorecard — \`${scorecard.suite}\` (${formatStatusBadge(overallPass)})`,
    '',
    `- **Timestamp:** \`${scorecard.timestampIso}\``,
    `- **Aggregate Score:** **${formatNumber(summary.aggregateScore)}**`,
    `- **Cases:** ${summary.passed}/${summary.total} passed (${summary.failed} failed)`,
    '',
  ];

  // Per-suite rollup table
  const suitesPresent = Array.from(new Set(cases.map((c) => c.suite))) as ConcreteSuiteName[];
  if (suitesPresent.length > 0) {
    lines.push('### Suite Summary', '');
    lines.push('| Suite | Total | Passed | Failed | Aggregate Score | Mean Latency (ms) |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const s of suitesPresent) {
      const sCases = cases.filter((c) => c.suite === s);
      const sPassed = sCases.filter((c) => c.passed).length;
      const sScore = sCases.reduce((acc, c) => acc + c.score, 0) / sCases.length;
      const sLatency = sCases.reduce((acc, c) => acc + c.latencyMs, 0) / sCases.length;
      lines.push(
        `| \`${s}\` | ${sCases.length} | ${sPassed} | ${sCases.length - sPassed} | ${sScore.toFixed(4)} | ${sLatency.toFixed(2)} |`,
      );
    }
    lines.push('');
  }

  // Detailed suite metrics
  const metricEntries = Object.entries(summary.suiteMetrics).sort(([a], [b]) => a.localeCompare(b));
  if (metricEntries.length > 0) {
    lines.push('### Suite Metrics', '');
    lines.push('| Metric | Value |');
    lines.push('| --- | ---: |');
    for (const [key, val] of metricEntries) {
      lines.push(`| \`${key}\` | ${formatNumber(val)} |`);
    }
    lines.push('');
  }

  // Baseline comparison gate
  if (comparison) {
    lines.push(
      `### Baseline Regression Gate (${formatStatusBadge(comparison.passed)}, maxRegression=${comparison.maxRegression})`,
      '',
    );
    if (comparison.regressions.length === 0) {
      lines.push('No regressions detected relative to baseline.', '');
    } else {
      lines.push('| Metric | Direction | Baseline | Current | Regression | Threshold |');
      lines.push('| --- | :---: | ---: | ---: | ---: | ---: |');
      for (const reg of comparison.regressions) {
        lines.push(
          `| \`${reg.metric}\` | ${reg.direction} | ${formatNumber(reg.baseline)} | ${formatNumber(reg.current)} | ${formatNumber(reg.regressionAmount)} | ${formatNumber(reg.threshold)} |`,
        );
      }
      lines.push('');
    }
  }

  // Case breakdown
  if (cases.length > 0) {
    lines.push('<details>');
    lines.push(`<summary>Case Breakdown (${cases.length} cases)</summary>`, '');
    lines.push('| Case ID | Suite | Status | Score | Latency (ms) |');
    lines.push('| --- | --- | :---: | ---: | ---: |');
    for (const c of cases) {
      lines.push(
        `| \`${c.id}\` | \`${c.suite}\` | ${formatStatusBadge(c.passed)} | ${c.score.toFixed(4)} | ${c.latencyMs.toFixed(2)} |`,
      );
    }
    lines.push('', '</details>', '');
  }

  return lines.join('\n');
}
