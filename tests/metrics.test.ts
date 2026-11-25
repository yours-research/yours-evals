import { describe, expect, it } from 'vitest';
import {
  clamp01,
  computeCompressionRatio,
  computeF1,
  computePrefixReuseRatio,
  computeRate,
  computeSetF1,
  computeTokenSavingsRatio,
  estimateTokens,
  mean,
  meanReciprocalRank,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  roundMetric,
} from '../src/metrics.js';

describe('metric math utilities', () => {
  it('computes token estimates and compression ratios deterministically', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('   ')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);

    const raw = 'a'.repeat(400); // 100 tokens
    const compressed = 'b'.repeat(100); // 25 tokens
    expect(computeCompressionRatio(raw, compressed)).toBe(4);
    expect(computeTokenSavingsRatio(raw, compressed)).toBe(0.75);
    expect(computeTokenSavingsRatio('', compressed)).toBe(0);
  });

  it('computes F1 and set F1 across edge cases', () => {
    expect(computeF1(4, 0, 0)).toEqual({ precision: 1, recall: 1, f1: 1 });
    expect(computeF1(0, 0, 0)).toEqual({ precision: 1, recall: 1, f1: 1 });
    expect(computeF1(0, 3, 2)).toEqual({ precision: 0, recall: 0, f1: 0 });
    const balanced = computeF1(3, 1, 1);
    expect(balanced.precision).toBeCloseTo(0.75, 5);
    expect(balanced.recall).toBeCloseTo(0.75, 5);
    expect(balanced.f1).toBeCloseTo(0.75, 5);

    const setRes = computeSetF1(['a', 'b', 'c'], ['b', 'c', 'd']);
    expect(setRes.precision).toBeCloseTo(2 / 3, 5);
    expect(setRes.recall).toBeCloseTo(2 / 3, 5);
    expect(setRes.f1).toBeCloseTo(2 / 3, 5);
  });

  it('computes Precision@K, Recall@K, MRR, and NDCG@K accurately', () => {
    const ranked = ['d2', 'd1', 'd4', 'd3'];
    const relevant = new Set(['d1', 'd3']);
    const grades = new Map([
      ['d1', 3],
      ['d3', 1],
    ]);

    expect(precisionAtK(ranked, relevant, 2)).toBe(0.5);
    expect(precisionAtK(ranked, relevant, 4)).toBe(0.5);
    expect(precisionAtK(ranked, relevant, 0)).toBe(0);

    expect(recallAtK(ranked, relevant, 2)).toBe(0.5);
    expect(recallAtK(ranked, relevant, 4)).toBe(1);

    // First relevant item is at index 1 -> rank 2 -> RR = 0.5
    expect(meanReciprocalRank(ranked, relevant)).toBe(0.5);
    expect(meanReciprocalRank(['x', 'y'], relevant)).toBe(0);

    // Ideal order: d1 (rel=3 at pos 1), d3 (rel=1 at pos 2)
    // IDCG = 7/log2(2) + 1/log2(3) = 7 + 0.63092975 = 7.63092975
    // DCG@4 for ['d2','d1','d4','d3']: 7/log2(3) + 1/log2(5) = 4.416508 + 0.430676 = 4.847185
    const ndcg = ndcgAtK(ranked, grades, 4);
    expect(ndcg).toBeCloseTo(4.847185 / 7.63093, 4);
    expect(ndcgAtK(['d1', 'd3'], grades, 2)).toBeCloseTo(1, 6);
  });

  it('computes prefix reuse ratio, rates, clamping, and rounding', () => {
    expect(computePrefixReuseRatio(60, 100)).toBe(0.6);
    expect(computePrefixReuseRatio(120, 100)).toBe(1);
    expect(computePrefixReuseRatio(10, 0)).toBe(0);
    expect(computeRate(3, 4)).toBe(0.75);
    expect(computeRate(1, 0)).toBe(0);
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(roundMetric(0.123456, 4)).toBe(0.1235);
  });
});
