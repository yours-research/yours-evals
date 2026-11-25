import type { VoicePipeline, VoiceState } from '../contracts.js';
import { VOICE_DATASET, type VadFrame, type VoiceEvalCase } from '../datasets/voice.js';
import { computeRate, mean, roundMetric } from '../metrics.js';
import { makeCaseResult, measureAsync, type SuiteRunOutput } from './common.js';

export interface VoiceSegmentWindow {
  startMs: number;
  endMs: number;
}

export interface VoiceEvalTarget {
  chunkSentences(tokens: readonly string[]): Promise<string[]> | string[];
  detectVadSegments(
    frames: readonly VadFrame[],
    frameDurationMs: number,
    preRollMs: number,
  ): Promise<VoiceSegmentWindow[]> | VoiceSegmentWindow[];
  createPipeline(): Promise<VoicePipeline> | VoicePipeline;
}

const ABBREVIATIONS = new Set([
  'dr.',
  'mr.',
  'mrs.',
  'ms.',
  'prof.',
  'sr.',
  'jr.',
  'e.g.',
  'i.e.',
  'etc.',
  'vs.',
  'u.s.a.',
]);

function isSentenceBoundary(buffer: string): boolean {
  const trimmed = buffer.trimEnd();
  if (trimmed.length === 0) return false;
  if (trimmed.endsWith('...')) return false;

  // Match terminal punctuation optionally followed by closing quote/paren
  const match = /([.!?])(["')\]])?$/.exec(trimmed);
  if (!match) return false;

  const punct = match[1]!;
  if (punct === '!' || punct === '?') return true;

  // For period, guard decimals/versions and abbreviations
  const words = trimmed.split(/\s+/);
  const lastWord = (words[words.length - 1] ?? '').toLowerCase().replace(/["')\]],]+$/g, '');
  if (ABBREVIATIONS.has(lastWord)) return false;
  if (/\d\.\d/.test(lastWord)) return false;
  if (/^(?:[a-z]\.){2,}$/i.test(lastWord)) return false;
  return true;
}

function baselineChunkSentences(tokens: readonly string[]): string[] {
  const chunks: string[] = [];
  let buffer = '';
  for (const token of tokens) {
    buffer += token;
    if (token.endsWith(' ') && isSentenceBoundary(buffer)) {
      const sentence = buffer.trim();
      if (sentence) chunks.push(sentence);
      buffer = '';
    }
  }
  const trailing = buffer.trim();
  if (trailing) chunks.push(trailing);
  return chunks;
}

function baselineDetectVadSegments(
  frames: readonly VadFrame[],
  frameDurationMs: number,
  preRollMs: number,
): VoiceSegmentWindow[] {
  const preRollFrames = Math.max(1, Math.ceil(preRollMs / frameDurationMs));
  const speechThreshold = 0.025;
  const hangoverFramesMax = 4;

  const segments: VoiceSegmentWindow[] = [];
  let inSpeech = false;
  let segmentStartMs = 0;
  let hangover = 0;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const active = frame.rmsEnergy >= speechThreshold;
    if (active) {
      if (!inSpeech) {
        inSpeech = true;
        const preRollIdx = Math.max(0, i - preRollFrames);
        segmentStartMs = frames[preRollIdx]!.timestampMs;
      }
      hangover = hangoverFramesMax;
    } else if (inSpeech) {
      hangover--;
      if (hangover <= 0) {
        inSpeech = false;
        segments.push({
          startMs: segmentStartMs,
          endMs: frame.timestampMs + frameDurationMs,
        });
      }
    }
  }

  if (inSpeech && frames.length > 0) {
    const last = frames[frames.length - 1]!;
    segments.push({
      startMs: segmentStartMs,
      endMs: last.timestampMs + frameDurationMs,
    });
  }
  return segments;
}

export function createBaselineVoicePipeline(): VoicePipeline {
  let currentState: VoiceState = 'idle';
  let abortController: AbortController | null = null;
  let disposed = false;

  return {
    get state(): VoiceState {
      return currentState;
    },
    async startListening() {
      if (disposed) throw new Error('Pipeline disposed');
      currentState = 'listening';
    },
    async stopListening() {
      if (currentState === 'listening' || currentState === 'speech-detected') {
        currentState = 'idle';
      }
    },
    async speak(textStream: string | AsyncIterable<string>) {
      if (disposed) throw new Error('Pipeline disposed');
      abortController?.abort();
      abortController = new AbortController();
      const signal = abortController.signal;
      currentState = 'speaking';
      try {
        if (typeof textStream === 'string') {
          if (signal.aborted) return;
          await new Promise((resolve) => setTimeout(resolve, 2));
        } else {
          for await (const _chunk of textStream) {
            if (signal.aborted) break;
            await new Promise((resolve) => setTimeout(resolve, 5));
            if (signal.aborted) break;
          }
        }
      } finally {
        if (currentState === 'speaking') {
          currentState = 'idle';
        }
      }
    },
    async bargeIn() {
      abortController?.abort();
      currentState = 'listening';
    },
    async dispose() {
      abortController?.abort();
      disposed = true;
      currentState = 'idle';
    },
  };
}

export function createBaselineVoiceTarget(): VoiceEvalTarget {
  return {
    chunkSentences: baselineChunkSentences,
    detectVadSegments: baselineDetectVadSegments,
    createPipeline: createBaselineVoicePipeline,
  };
}

function countGroundTruthSpeechFrames(frames: readonly VadFrame[]): {
  totalSpeechFrames: number;
  capturedFrames: (segments: readonly VoiceSegmentWindow[]) => number;
} {
  const speechFrames = frames.filter((f) => f.hasSpeechGroundTruth);
  return {
    totalSpeechFrames: speechFrames.length,
    capturedFrames(segments) {
      let captured = 0;
      for (const f of speechFrames) {
        if (segments.some((seg) => f.timestampMs >= seg.startMs && f.timestampMs < seg.endMs)) {
          captured++;
        }
      }
      return captured;
    },
  };
}

export async function runVoiceSuite(
  target: VoiceEvalTarget = createBaselineVoiceTarget(),
  dataset: readonly VoiceEvalCase[] = VOICE_DATASET,
): Promise<SuiteRunOutput> {
  const cases = [];
  const chunkAccuracies: number[] = [];
  const chunkLatencies: number[] = [];
  const clippingRates: number[] = [];
  const bargeInPasses: number[] = [];
  const bargeInLatencies: number[] = [];

  for (const item of dataset) {
    if (item.kind === 'sentence_chunking') {
      const { result: actualChunks, latencyMs } = await measureAsync(() =>
        target.chunkSentences(item.tokens),
      );
      const maxLen = Math.max(item.expectedChunks.length, actualChunks.length);
      let exactMatches = 0;
      for (let i = 0; i < maxLen; i++) {
        if (actualChunks[i] === item.expectedChunks[i]) exactMatches++;
      }
      const accuracy = computeRate(exactMatches, maxLen);
      const passed = accuracy === 1 && latencyMs <= item.maxChunkLatencyMs;
      chunkAccuracies.push(accuracy);
      chunkLatencies.push(latencyMs);
      cases.push(
        makeCaseResult({
          id: item.id,
          suite: 'voice',
          passed,
          score: accuracy,
          latencyMs,
          metrics: {
            kind: item.kind,
            boundaryAccuracy: roundMetric(accuracy, 4),
            expectedCount: item.expectedChunks.length,
            actualCount: actualChunks.length,
          },
        }),
      );
    } else if (item.kind === 'vad_onset') {
      const { result: segments, latencyMs } = await measureAsync(() =>
        target.detectVadSegments(item.frames, item.frameDurationMs, item.preRollMs),
      );
      const gt = countGroundTruthSpeechFrames(item.frames);
      const captured = gt.capturedFrames(segments);
      const clippingRate = 1 - computeRate(captured, gt.totalSpeechFrames);
      const passed = clippingRate <= item.maxAllowedClippingRate && segments.length > 0;
      const score = Math.max(0, 1 - clippingRate);
      clippingRates.push(clippingRate);
      cases.push(
        makeCaseResult({
          id: item.id,
          suite: 'voice',
          passed,
          score,
          latencyMs,
          metrics: {
            kind: item.kind,
            onsetClippingRate: roundMetric(clippingRate, 4),
            capturedFrames: captured,
            totalSpeechFrames: gt.totalSpeechFrames,
          },
        }),
      );
    } else {
      const bargeCase = item;
      const pipeline = await target.createPipeline();

      const {
        result: { teardownMs, stateAfterBargeIn, speakSettledQuickly },
        latencyMs,
      } = await measureAsync(async () => {
        async function* streamChunks(): AsyncIterable<string> {
          for (let i = 0; i < bargeCase.utteranceChunks.length; i++) {
            yield bargeCase.utteranceChunks[i]!;
            await new Promise((resolve) => setTimeout(resolve, 15));
          }
        }

        const speakPromise = pipeline.speak(streamChunks());
        await new Promise((resolve) =>
          setTimeout(resolve, (bargeCase.interruptAfterChunkIndex + 1) * 8),
        );
        const t0 = performance.now();
        await pipeline.bargeIn();
        let settledQuickly = false;
        await Promise.race([
          speakPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Barge-in teardown timeout')), bargeCase.slaMs),
          ),
        ]).then(
          () => {
            settledQuickly = true;
          },
          () => {
            settledQuickly = false;
          },
        );
        const elapsed = roundMetric(performance.now() - t0, 3);
        const postState: VoiceState = pipeline.state;
        await pipeline.dispose();
        return {
          teardownMs: elapsed,
          stateAfterBargeIn: postState,
          speakSettledQuickly: settledQuickly,
        };
      });

      const passed =
        speakSettledQuickly &&
        teardownMs <= bargeCase.slaMs &&
        stateAfterBargeIn !== 'speaking';
      bargeInPasses.push(passed ? 1 : 0);
      bargeInLatencies.push(teardownMs);
      cases.push(
        makeCaseResult({
          id: bargeCase.id,
          suite: 'voice',
          passed,
          score: passed ? 1 : 0,
          latencyMs,
          metrics: {
            kind: bargeCase.kind,
            teardownMs,
            slaMs: bargeCase.slaMs,
            stateAfterBargeIn,
          },
        }),
      );
    }
  }

  const suiteMetrics: Record<string, number> = {
    chunkBoundaryAccuracy: roundMetric(mean(chunkAccuracies), 4),
    meanChunkLatencyMs: roundMetric(mean(chunkLatencies), 3),
    vadOnsetClippingRate: roundMetric(mean(clippingRates), 4),
    bargeInSlaPassRate: roundMetric(mean(bargeInPasses), 4),
    meanBargeInTeardownMs: roundMetric(mean(bargeInLatencies), 3),
  };

  return {
    suite: 'voice',
    cases,
    suiteMetrics,
    aggregateScore: roundMetric(mean(cases.map((c) => c.score)), 4),
  };
}
