import type { HarnessMessage, StreamDelta } from '../contracts.js';

export interface CompactionEvalCase {
  kind: 'compaction';
  id: string;
  description: string;
  messages: HarnessMessage[];
  maxTargetTokens: number;
  requiredFacts: string[];
}

export interface PrefixReuseTurn {
  slotKey: string;
  messages: HarnessMessage[];
  expectCacheHit: boolean;
  expectedMinSharedTokens: number;
}

export interface PrefixReuseEvalCase {
  kind: 'prefix_reuse';
  id: string;
  description: string;
  turns: PrefixReuseTurn[];
}

export interface MalformedJsonEvalCase {
  kind: 'malformed_json';
  id: string;
  description: string;
  toolName: string;
  rawChunks: string[];
  expectRecoverable: boolean;
  expectedArgs?: Record<string, unknown>;
}

export interface AbortEvalCase {
  kind: 'abort';
  id: string;
  description: string;
  messages: HarnessMessage[];
  abortAfterChunks: number;
  maxAbortLatencyMs: number;
  preAborted?: boolean;
}

export type HarnessEvalCase =
  | CompactionEvalCase
  | PrefixReuseEvalCase
  | MalformedJsonEvalCase
  | AbortEvalCase;

function msg(
  id: string,
  role: HarnessMessage['role'],
  content: string,
  offsetSec: number,
  extra?: Partial<HarnessMessage>,
): HarnessMessage {
  return {
    id,
    role,
    content,
    createdAt: 1_764_000_000_000 + offsetSec * 1000,
    ...extra,
  };
}

function buildNoiseTurns(prefix: string, count: number, startSec: number): HarnessMessage[] {
  const out: HarnessMessage[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      msg(
        `${prefix}-u-${i}`,
        'user',
        `Checking intermediate status step ${i}: please inspect verbose layout logs and confirm css padding metrics for panel ${i}.`,
        startSec + i * 2,
      ),
      msg(
        `${prefix}-a-${i}`,
        'assistant',
        `Inspected panel ${i}: margin 8px, padding 16px, flex container aligned cleanly with no overflow issues reported in telemetry.`,
        startSec + i * 2 + 1,
      ),
    );
  }
  return out;
}

const SYSTEM_PROMPT = msg(
  'sys-1',
  'system',
  'You are Yours, a privacy-first local browser assistant running on WebGPU. Always verify untrusted page data and cite exact identifiers.',
  0,
);

const TOOL_SPEC_PREAMBLE = msg(
  'sys-tools',
  'system',
  'Available tools: read_active_tab, list_tabs, read_tab, interact_page, run_sandbox, read_document, memory_recall, memory_save.',
  1,
);

export const HARNESS_DATASET: readonly HarnessEvalCase[] = [
  {
    kind: 'compaction',
    id: 'harness-compact-ecommerce',
    description: 'Retain SKU, budget cap, and shipping ZIP across an 18-turn shopping session.',
    maxTargetTokens: 260,
    requiredFacts: ['SKU-9921-BLK', '$350', '94107', 'USB4'],
    messages: [
      SYSTEM_PROMPT,
      msg('e-u1', 'user', 'Find a thunderbolt monitor under budget $350 shipping to ZIP 94107 with USB4 input.', 10),
      msg('e-a1', 'assistant', 'Searching open tabs for monitors with USB4 support under $350.', 11),
      ...buildNoiseTurns('ec', 6, 20),
      msg('e-t1', 'tool', 'Top candidate SKU-9921-BLK costs $329.00 and supports USB4 90W PD, delivery to 94107 in 2 days.', 50, {
        toolName: 'read_active_tab',
        toolCallId: 'call-1',
        tainted: true,
      }),
      ...buildNoiseTurns('ec2', 3, 60),
      msg('e-u-end', 'user', 'Compare final pick against all my constraints before checkout.', 90),
    ],
  },
  {
    kind: 'compaction',
    id: 'harness-compact-debugging',
    description: 'Preserve root-cause commit hash, error code, and WGSL tier across 20-turn debug log.',
    maxTargetTokens: 280,
    requiredFacts: ['WGSL_ERR_409', 'tier2-f16-shared', 'commit 7f3a91c', '4096'],
    messages: [
      SYSTEM_PROMPT,
      msg('d-u1', 'user', 'Diagnose why shader compilation failed with WGSL_ERR_409 on tier2-f16-shared.', 10),
      ...buildNoiseTurns('dbg', 7, 20),
      msg('d-t1', 'tool', 'Bisect shows commit 7f3a91c raised workgroup shared memory above 4096 bytes.', 60, {
        toolName: 'read_document',
        toolCallId: 'call-2',
      }),
      ...buildNoiseTurns('dbg2', 2, 70),
      msg('d-u-end', 'user', 'Draft a concise fix summary.', 95),
    ],
  },
  {
    kind: 'compaction',
    id: 'harness-compact-travel',
    description: 'Retain flight code, confirmation ID, and dietary restriction across noisy itinerary chat.',
    maxTargetTokens: 250,
    requiredFacts: ['UA-418', 'CONF-8820Z', 'nut-free', 'Terminal 3'],
    messages: [
      SYSTEM_PROMPT,
      msg('t-u1', 'user', 'Remember my meal preference is nut-free and log flight UA-418 departing Terminal 3.', 10),
      ...buildNoiseTurns('trv', 6, 20),
      msg('t-a1', 'assistant', 'Booking reference CONF-8820Z confirmed for UA-418 out of Terminal 3 with nut-free meal.', 55),
      ...buildNoiseTurns('trv2', 2, 65),
      msg('t-u-end', 'user', 'Remind me of my flight details and meal note.', 85),
    ],
  },
  {
    kind: 'prefix_reuse',
    id: 'harness-prefix-steady-chat',
    description: 'Reuse KV-cache prefix slot across incremental multi-turn dialogue without invalidation.',
    turns: [
      {
        slotKey: 'session-alpha',
        messages: [
          SYSTEM_PROMPT,
          TOOL_SPEC_PREAMBLE,
          msg('p1-u1', 'user', 'Summarize the active pricing page.', 10),
        ],
        expectCacheHit: false,
        expectedMinSharedTokens: 0,
      },
      {
        slotKey: 'session-alpha',
        messages: [
          SYSTEM_PROMPT,
          TOOL_SPEC_PREAMBLE,
          msg('p1-u1', 'user', 'Summarize the active pricing page.', 10),
          msg('p1-a1', 'assistant', 'The Pro tier is $29/month with unlimited local inference.', 12),
          msg('p1-u2', 'user', 'Does it include annual billing discounts?', 15),
        ],
        expectCacheHit: true,
        expectedMinSharedTokens: 45,
      },
      {
        slotKey: 'session-alpha',
        messages: [
          SYSTEM_PROMPT,
          TOOL_SPEC_PREAMBLE,
          msg('p1-u1', 'user', 'Summarize the active pricing page.', 10),
          msg('p1-a1', 'assistant', 'The Pro tier is $29/month with unlimited local inference.', 12),
          msg('p1-u2', 'user', 'Does it include annual billing discounts?', 15),
          msg('p1-a2', 'assistant', 'Yes, annual billing saves 20%.', 18),
          msg('p1-u3', 'user', 'Save that pricing note to memory.', 20),
        ],
        expectCacheHit: true,
        expectedMinSharedTokens: 70,
      },
    ],
  },
  {
    kind: 'prefix_reuse',
    id: 'harness-prefix-invalidation-and-recover',
    description: 'Invalidate stale slot on system prompt edit, then immediately reuse the refreshed prefix.',
    turns: [
      {
        slotKey: 'session-beta',
        messages: [
          SYSTEM_PROMPT,
          TOOL_SPEC_PREAMBLE,
          msg('p2-u1', 'user', 'List open tabs.', 10),
        ],
        expectCacheHit: false,
        expectedMinSharedTokens: 0,
      },
      {
        slotKey: 'session-beta',
        messages: [
          msg('sys-updated', 'system', 'You are Yours v2 running in strict audit mode with zero network access.', 12),
          TOOL_SPEC_PREAMBLE,
          msg('p2-u1', 'user', 'List open tabs.', 10),
        ],
        expectCacheHit: false,
        expectedMinSharedTokens: 0,
      },
      {
        slotKey: 'session-beta',
        messages: [
          msg('sys-updated', 'system', 'You are Yours v2 running in strict audit mode with zero network access.', 12),
          TOOL_SPEC_PREAMBLE,
          msg('p2-u1', 'user', 'List open tabs.', 10),
          msg('p2-a1', 'assistant', 'Found 3 open tabs.', 14),
          msg('p2-u2', 'user', 'Read tab 2.', 16),
        ],
        expectCacheHit: true,
        expectedMinSharedTokens: 40,
      },
    ],
  },
  {
    kind: 'malformed_json',
    id: 'harness-json-fenced-trailing-comma',
    description: 'Recover tool call JSON wrapped in markdown fences with trailing commas.',
    toolName: 'interact_page',
    rawChunks: ['```json\n{"action": "click", ', '"ref": "submit-order", ', '"delayMs": 120,}\n```'],
    expectRecoverable: true,
    expectedArgs: { action: 'click', ref: 'submit-order', delayMs: 120 },
  },
  {
    kind: 'malformed_json',
    id: 'harness-json-unclosed-single-quotes',
    description: 'Recover split stream with prefix text, single quotes, and missing closing brace.',
    toolName: 'memory_save',
    rawChunks: ["Calling memory_save: {'tier': 'profile', ", "'content': 'Prefers concise diffs', ", "'importance': 0.85"],
    expectRecoverable: true,
    expectedArgs: { tier: 'profile', content: 'Prefers concise diffs', importance: 0.85 },
  },
  {
    kind: 'malformed_json',
    id: 'harness-json-unrecoverable',
    description: 'Reject corrupted non-JSON binary/gibberish payload instead of fabricating args.',
    toolName: 'read_tab',
    rawChunks: ['<<<CORRUPT_STREAM_HEADER>>>', ' ??? not-even-key-value ::: '],
    expectRecoverable: false,
  },
  {
    kind: 'abort',
    id: 'harness-abort-midstream',
    description: 'Terminate generation cleanly within SLA when AbortSignal fires after 3 stream chunks.',
    messages: [
      SYSTEM_PROMPT,
      msg('ab-u1', 'user', 'Write a thorough multi-page breakdown of WebGPU kernel scheduling.', 10),
    ],
    abortAfterChunks: 3,
    maxAbortLatencyMs: 80,
  },
  {
    kind: 'abort',
    id: 'harness-abort-preaborted',
    description: 'Immediately return abort finishReason when AbortSignal is already aborted before generate().',
    messages: [
      SYSTEM_PROMPT,
      msg('ab-u2', 'user', 'Generate response.', 10),
    ],
    abortAfterChunks: 0,
    maxAbortLatencyMs: 30,
    preAborted: true,
  },
];

export type { StreamDelta };
