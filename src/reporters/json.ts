import type { EvalScorecard } from '../contracts.js';

export function formatScorecardJson(scorecard: EvalScorecard, pretty = true): string {
  return pretty ? JSON.stringify(scorecard, null, 2) : JSON.stringify(scorecard);
}
