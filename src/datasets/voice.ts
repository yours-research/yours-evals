export interface SentenceChunkEvalCase {
  kind: 'sentence_chunking';
  id: string;
  description: string;
  tokens: string[];
  expectedChunks: string[];
  maxChunkLatencyMs: number;
}

export interface VadFrame {
  timestampMs: number;
  rmsEnergy: number;
  hasSpeechGroundTruth: boolean;
}

export interface VadOnsetEvalCase {
  kind: 'vad_onset';
  id: string;
  description: string;
  frameDurationMs: number;
  preRollMs: number;
  frames: VadFrame[];
  maxAllowedClippingRate: number;
}

export interface BargeInEvalCase {
  kind: 'barge_in';
  id: string;
  description: string;
  utteranceChunks: string[];
  interruptAfterChunkIndex: number;
  slaMs: number;
}

export type VoiceEvalCase = SentenceChunkEvalCase | VadOnsetEvalCase | BargeInEvalCase;

function makeFrames(
  specs: Array<{ count: number; energy: number; speech: boolean }>,
  frameDurationMs = 20,
): VadFrame[] {
  const frames: VadFrame[] = [];
  let t = 0;
  for (const spec of specs) {
    for (let i = 0; i < spec.count; i++) {
      frames.push({
        timestampMs: t,
        rmsEnergy: spec.energy,
        hasSpeechGroundTruth: spec.speech,
      });
      t += frameDurationMs;
    }
  }
  return frames;
}

export const VOICE_DATASET: readonly VoiceEvalCase[] = [
  {
    kind: 'sentence_chunking',
    id: 'voice-chunk-abbreviations',
    description: 'Do not split on Dr., e.g., or U.S.A.; split cleanly at true sentence boundaries.',
    maxChunkLatencyMs: 25,
    tokens: [
      'Dr. ',
      'Patel ',
      'visited ',
      'the ',
      'U.S.A. ',
      'lab ',
      'yesterday. ',
      'She ',
      'tested ',
      'e.g. ',
      'three ',
      'models! ',
      'Ready ',
      'to ',
      'ship?',
    ],
    expectedChunks: [
      'Dr. Patel visited the U.S.A. lab yesterday.',
      'She tested e.g. three models!',
      'Ready to ship?',
    ],
  },
  {
    kind: 'sentence_chunking',
    id: 'voice-chunk-decimals-versions',
    description: 'Preserve currency decimals ($49.99) and semantic versions (v2.4.1) inside single chunks.',
    maxChunkLatencyMs: 25,
    tokens: [
      'Upgrade ',
      'to ',
      'v2.4.1 ',
      'costs ',
      '$49.99 ',
      'today. ',
      'Latency ',
      'dropped ',
      'by ',
      '3.5 ',
      'ms.',
    ],
    expectedChunks: [
      'Upgrade to v2.4.1 costs $49.99 today.',
      'Latency dropped by 3.5 ms.',
    ],
  },
  {
    kind: 'sentence_chunking',
    id: 'voice-chunk-dialogue-quotes',
    description: 'Handle punctuation inside quotes and trailing ellipsis without fragmenting mid-clause.',
    maxChunkLatencyMs: 25,
    tokens: [
      'Wait... ',
      'did ',
      'she ',
      'say ',
      '"Run ',
      'locally"? ',
      'Yes, ',
      'everything ',
      'stays ',
      'offline.',
    ],
    expectedChunks: [
      'Wait... did she say "Run locally"?',
      'Yes, everything stays offline.',
    ],
  },
  {
    kind: 'sentence_chunking',
    id: 'voice-chunk-flush-incomplete',
    description: 'Flush final trailing clause cleanly when stream closes without terminal punctuation.',
    maxChunkLatencyMs: 25,
    tokens: [
      'First ',
      'sentence ',
      'is ',
      'complete. ',
      'Second ',
      'clause ',
      'streams ',
      'to ',
      'end',
    ],
    expectedChunks: [
      'First sentence is complete.',
      'Second clause streams to end',
    ],
  },
  {
    kind: 'vad_onset',
    id: 'voice-vad-clean-preroll',
    description: 'Capture soft speech onset frames using 120ms pre-roll ring buffer with zero clipping.',
    frameDurationMs: 20,
    preRollMs: 120,
    maxAllowedClippingRate: 0.05,
    frames: makeFrames([
      { count: 10, energy: 0.005, speech: false },
      { count: 2, energy: 0.022, speech: true }, // soft onset frames
      { count: 15, energy: 0.09, speech: true },
      { count: 6, energy: 0.004, speech: false },
    ]),
  },
  {
    kind: 'vad_onset',
    id: 'voice-vad-noisy-onset',
    description: 'Distinguish ambient fan floor (0.014) from genuine speech onset without clipping.',
    frameDurationMs: 20,
    preRollMs: 120,
    maxAllowedClippingRate: 0.08,
    frames: makeFrames([
      { count: 12, energy: 0.014, speech: false },
      { count: 3, energy: 0.026, speech: true },
      { count: 12, energy: 0.11, speech: true },
      { count: 8, energy: 0.012, speech: false },
    ]),
  },
  {
    kind: 'vad_onset',
    id: 'voice-vad-multi-utterance',
    description: 'Handle two separate utterances separated by a 400ms silence gap without losing second onset.',
    frameDurationMs: 20,
    preRollMs: 100,
    maxAllowedClippingRate: 0.08,
    frames: makeFrames([
      { count: 8, energy: 0.006, speech: false },
      { count: 2, energy: 0.024, speech: true },
      { count: 10, energy: 0.085, speech: true },
      { count: 20, energy: 0.005, speech: false }, // 400ms gap
      { count: 2, energy: 0.025, speech: true },
      { count: 10, energy: 0.095, speech: true },
      { count: 5, energy: 0.005, speech: false },
    ]),
  },
  {
    kind: 'barge_in',
    id: 'voice-barge-in-mid-speech',
    description: 'Teardown active TTS playback within 150ms SLA when user speaks mid-response.',
    interruptAfterChunkIndex: 1,
    slaMs: 150,
    utteranceChunks: [
      'Sure, I found three open tabs matching your query.',
      'The first tab contains the quarterly performance metrics.',
      'Would you like me to summarize the remaining two tabs?',
    ],
  },
  {
    kind: 'barge_in',
    id: 'voice-barge-in-immediate',
    description: 'Teardown TTS promptly on immediate first-chunk interruption and reset state cleanly.',
    interruptAfterChunkIndex: 0,
    slaMs: 150,
    utteranceChunks: [
      'Reading your lengthy release changelog from top to bottom.',
      'Section two covers WebGPU memory optimizations.',
    ],
  },
];
