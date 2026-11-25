/**
 * Pure, deterministic evaluation metric math utilities.
 */

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function roundMetric(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) {
    sum += Number.isFinite(v) ? v : 0;
  }
  return sum / values.length;
}

export function computeRate(numerator: number, denominator: number): number {
  if (denominator <= 0 || !Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return 0;
  }
  return clamp01(numerator / denominator);
}

/**
 * Deterministic GPT-style ~4 chars/token estimator for budget and compression math.
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function computeCompressionRatio(rawText: string, compressedText: string): number {
  const rawTokens = estimateTokens(rawText);
  const compressedTokens = Math.max(1, estimateTokens(compressedText));
  if (rawTokens === 0) return 1;
  return rawTokens / compressedTokens;
}

export function computeTokenSavingsRatio(rawText: string, compressedText: string): number {
  const rawTokens = estimateTokens(rawText);
  if (rawTokens === 0) return 0;
  const compressedTokens = estimateTokens(compressedText);
  return clamp01(1 - compressedTokens / rawTokens);
}

export function computeF1(tp: number, fp: number, fn: number): {
  precision: number;
  recall: number;
  f1: number;
} {
  const precision = tp + fp === 0 ? (fn === 0 ? 1 : 0) : tp / (tp + fp);
  const recall = tp + fn === 0 ? (fp === 0 ? 1 : 0) : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    precision: clamp01(precision),
    recall: clamp01(recall),
    f1: clamp01(f1),
  };
}

export function computeSetF1(
  expected: Iterable<string>,
  actual: Iterable<string>,
): { precision: number; recall: number; f1: number } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  let tp = 0;
  for (const item of actualSet) {
    if (expectedSet.has(item)) tp++;
  }
  const fp = actualSet.size - tp;
  const fn = expectedSet.size - tp;
  return computeF1(tp, fp, fn);
}

export function precisionAtK(
  rankedIds: readonly string[],
  relevantIds: ReadonlySet<string>,
  k: number,
): number {
  if (k <= 0) return 0;
  const topK = rankedIds.slice(0, k);
  if (topK.length === 0) return 0;
  let hits = 0;
  for (const id of topK) {
    if (relevantIds.has(id)) hits++;
  }
  return clamp01(hits / k);
}

export function recallAtK(
  rankedIds: readonly string[],
  relevantIds: ReadonlySet<string>,
  k: number,
): number {
  if (relevantIds.size === 0) return 1;
  if (k <= 0) return 0;
  const topK = rankedIds.slice(0, k);
  let hits = 0;
  const seen = new Set<string>();
  for (const id of topK) {
    if (relevantIds.has(id) && !seen.has(id)) {
      seen.add(id);
      hits++;
    }
  }
  return clamp01(hits / relevantIds.size);
}

export function meanReciprocalRank(
  rankedIds: readonly string[],
  relevantIds: ReadonlySet<string>,
): number {
  for (let i = 0; i < rankedIds.length; i++) {
    const id = rankedIds[i];
    if (id !== undefined && relevantIds.has(id)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export function ndcgAtK(
  rankedIds: readonly string[],
  relevanceGrades: ReadonlyMap<string, number>,
  k: number,
): number {
  if (k <= 0) return 0;
  const topK = rankedIds.slice(0, k);
  const dcg = topK.reduce((acc, id, idx) => {
    const rel = relevanceGrades.get(id) ?? 0;
    if (rel <= 0) return acc;
    return acc + (2 ** rel - 1) / Math.log2(idx + 2);
  }, 0);

  const idealGrades = Array.from(relevanceGrades.values())
    .filter((g) => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k);
  const idcg = idealGrades.reduce((acc, rel, idx) => {
    return acc + (2 ** rel - 1) / Math.log2(idx + 2);
  }, 0);

  if (idcg === 0) return 0;
  return clamp01(dcg / idcg);
}

export function computePrefixReuseRatio(
  cachedPrefixTokens: number,
  totalPromptTokens: number,
): number {
  if (totalPromptTokens <= 0 || cachedPrefixTokens <= 0) return 0;
  return clamp01(cachedPrefixTokens / totalPromptTokens);
}
