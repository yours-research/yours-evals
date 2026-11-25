import vm from 'node:vm';
import type { CanonicalToolName, ToolDefinition } from '../contracts.js';
import {
  TOOLS_DATASET,
  type AomCompressionCase,
  type MultiHopCase,
  type MultiHopTabFixture,
  type SandboxCase,
  type SchemaValidationCase,
  type ToolsEvalCase,
} from '../datasets/tools.js';
import {
  computeCompressionRatio,
  computeF1,
  computeRate,
  computeTokenSavingsRatio,
  mean,
  roundMetric,
} from '../metrics.js';
import { makeCaseResult, measureAsync, type SuiteRunOutput } from './common.js';

export interface ToolsSchemaValidationOutput {
  valid: boolean;
  canonicalName?: CanonicalToolName;
  error?: string;
}

export interface ToolsSandboxOutput {
  blocked: boolean;
  output?: string | number;
  error?: string;
}

export interface ToolsEvalTarget {
  distillAom(rawHtml: string, url: string): Promise<string> | string;
  validateToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolsSchemaValidationOutput> | ToolsSchemaValidationOutput;
  runSandbox(code: string): Promise<ToolsSandboxOutput> | ToolsSandboxOutput;
  extractMultiHop(
    question: string,
    tabs: readonly MultiHopTabFixture[],
  ): Promise<string> | string;
}

interface ParamRule {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  nonEmpty?: boolean;
}

export const CANONICAL_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'read_active_tab',
    aliases: ['read_active_page'],
    description: 'Read semantic AOM of the active tab.',
    parameters: {
      type: 'object',
      properties: {
        includeLinks: { type: 'boolean' },
        maxTokens: { type: 'number' },
      },
      additionalProperties: false,
    },
    safety: { readOnlyHint: true, consequentialHint: false, networkHint: false, untrustedContentHint: true },
  },
  {
    name: 'list_tabs',
    aliases: ['list_open_tabs'],
    description: 'List open browser tabs.',
    parameters: {
      type: 'object',
      properties: { windowId: { type: 'string' } },
      additionalProperties: false,
    },
    safety: { readOnlyHint: true, consequentialHint: false, networkHint: false, untrustedContentHint: false },
  },
  {
    name: 'read_tab',
    description: 'Read semantic AOM of a specific tab by id.',
    parameters: {
      type: 'object',
      properties: { tabId: { type: 'number' }, maxTokens: { type: 'number' } },
      required: ['tabId'],
      additionalProperties: false,
    },
    safety: { readOnlyHint: true, consequentialHint: false, networkHint: false, untrustedContentHint: true },
  },
  {
    name: 'interact_page',
    description: 'Interact with a DOM reference on the active page.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        ref: { type: 'string' },
        text: { type: 'string' },
        delayMs: { type: 'number' },
      },
      required: ['action', 'ref'],
      additionalProperties: false,
    },
    safety: { readOnlyHint: false, consequentialHint: true, networkHint: false, untrustedContentHint: false },
  },
  {
    name: 'run_sandbox',
    aliases: ['js_calc'],
    description: 'Evaluate deterministic arithmetic or JSON transforms in an isolated sandbox.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
      additionalProperties: false,
    },
    safety: { readOnlyHint: true, consequentialHint: false, networkHint: false, untrustedContentHint: false },
  },
  {
    name: 'read_document',
    description: 'Extract text from a local or tab PDF/document.',
    parameters: {
      type: 'object',
      properties: { uri: { type: 'string' }, pageRange: { type: 'string' } },
      required: ['uri'],
      additionalProperties: false,
    },
    safety: { readOnlyHint: true, consequentialHint: false, networkHint: false, untrustedContentHint: true },
  },
  {
    name: 'search_web_tab',
    aliases: ['web_search'],
    description: 'Perform a search in a visible browser tab.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
      additionalProperties: false,
    },
    safety: { readOnlyHint: true, consequentialHint: false, networkHint: true, untrustedContentHint: true },
  },
  {
    name: 'fetch_background_tab',
    aliases: ['fetch_and_read_url'],
    description: 'Fetch a URL in an isolated background tab.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' }, maxTokens: { type: 'number' } },
      required: ['url'],
      additionalProperties: false,
    },
    safety: { readOnlyHint: true, consequentialHint: true, networkHint: true, untrustedContentHint: true },
  },
  {
    name: 'memory_recall',
    description: 'Recall relevant memories from local memory.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
      additionalProperties: false,
    },
    safety: { readOnlyHint: true, consequentialHint: false, networkHint: false, untrustedContentHint: false },
  },
  {
    name: 'memory_save',
    description: 'Save a memory record locally.',
    parameters: {
      type: 'object',
      properties: {
        tier: { type: 'string' },
        content: { type: 'string' },
        importance: { type: 'number' },
      },
      required: ['tier', 'content'],
      additionalProperties: false,
    },
    safety: { readOnlyHint: false, consequentialHint: true, networkHint: false, untrustedContentHint: false },
  },
];

const SCHEMA_RULES: Record<CanonicalToolName, Record<string, ParamRule>> = {
  read_active_tab: {
    includeLinks: { type: 'boolean' },
    maxTokens: { type: 'number' },
  },
  list_tabs: {
    windowId: { type: 'string', nonEmpty: true },
  },
  read_tab: {
    tabId: { type: 'number', required: true },
    maxTokens: { type: 'number' },
  },
  interact_page: {
    action: { type: 'string', required: true, nonEmpty: true },
    ref: { type: 'string', required: true, nonEmpty: true },
    text: { type: 'string' },
    delayMs: { type: 'number' },
  },
  run_sandbox: {
    code: { type: 'string', required: true, nonEmpty: true },
  },
  read_document: {
    uri: { type: 'string', required: true, nonEmpty: true },
    pageRange: { type: 'string' },
  },
  search_web_tab: {
    query: { type: 'string', required: true, nonEmpty: true },
    limit: { type: 'number' },
  },
  fetch_background_tab: {
    url: { type: 'string', required: true, nonEmpty: true },
    maxTokens: { type: 'number' },
  },
  memory_recall: {
    query: { type: 'string', required: true, nonEmpty: true },
    limit: { type: 'number' },
  },
  memory_save: {
    tier: { type: 'string', required: true, nonEmpty: true },
    content: { type: 'string', required: true, nonEmpty: true },
    importance: { type: 'number' },
  },
};

const ALIAS_TO_CANONICAL: Record<string, CanonicalToolName> = {
  read_active_tab: 'read_active_tab',
  read_active_page: 'read_active_tab',
  list_tabs: 'list_tabs',
  list_open_tabs: 'list_tabs',
  read_tab: 'read_tab',
  interact_page: 'interact_page',
  run_sandbox: 'run_sandbox',
  js_calc: 'run_sandbox',
  read_document: 'read_document',
  search_web_tab: 'search_web_tab',
  web_search: 'search_web_tab',
  fetch_background_tab: 'fetch_background_tab',
  fetch_and_read_url: 'fetch_background_tab',
  memory_recall: 'memory_recall',
  memory_save: 'memory_save',
};

const FORBIDDEN_SANDBOX_PATTERNS: readonly RegExp[] = [
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\beval\s*\(/,
  /\bFunction\b/,
  /\bconstructor\b/,
  /\b__proto__\b/,
  /\bwhile\s*\(\s*true\s*\)/,
  /\bfor\s*\(\s*;\s*;\s*\)/,
];

function baselineDistillAom(rawHtml: string, url: string): string {
  const stripped = rawHtml
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<div\b[^>]*(?:cookie-wall|ad-slot)[^>]*>[\s\S]*?<\/div>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ');

  const lines: string[] = [`@url ${url}`];
  const tagRegex = /<(h[1-6]|p|span|a|button|label|li|option)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  let refIdx = 1;
  while ((match = tagRegex.exec(stripped)) !== null) {
    const tag = (match[1] ?? '').toLowerCase();
    const inner = (match[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!inner) continue;
    const role = tag.startsWith('h')
      ? 'heading'
      : tag === 'a'
        ? 'link'
        : tag === 'button'
          ? 'button'
          : 'text';
    lines.push(`[${role} #r${refIdx++}] ${inner}`);
  }
  return lines.join('\n');
}

function baselineValidateToolCall(
  toolName: string,
  args: Record<string, unknown>,
): ToolsSchemaValidationOutput {
  const canonical = ALIAS_TO_CANONICAL[toolName];
  if (!canonical) {
    return { valid: false, error: `Unknown tool "${toolName}"` };
  }
  const rules = SCHEMA_RULES[canonical];
  for (const [key, rule] of Object.entries(rules)) {
    const val = args[key];
    if (val === undefined) {
      if (rule.required) {
        return { valid: false, canonicalName: canonical, error: `Missing required parameter "${key}"` };
      }
      continue;
    }
    if (typeof val !== rule.type || (rule.type === 'number' && !Number.isFinite(val))) {
      return { valid: false, canonicalName: canonical, error: `Invalid type for "${key}"` };
    }
    if (rule.nonEmpty && typeof val === 'string' && val.trim().length === 0) {
      return { valid: false, canonicalName: canonical, error: `Empty string for "${key}"` };
    }
  }
  for (const key of Object.keys(args)) {
    if (!(key in rules)) {
      return {
        valid: false,
        canonicalName: canonical,
        error: `Unexpected property "${key}" (additionalProperties: false)`,
      };
    }
  }
  return { valid: true, canonicalName: canonical };
}

function baselineRunSandbox(code: string): ToolsSandboxOutput {
  for (const pattern of FORBIDDEN_SANDBOX_PATTERNS) {
    if (pattern.test(code)) {
      return { blocked: true, error: `Blocked unsafe sandbox expression matching ${pattern.source}` };
    }
  }
  try {
    const context = vm.createContext(
      Object.freeze({ Math, JSON }),
      { codeGeneration: { strings: false, wasm: false } },
    );
    const result = vm.runInContext(code, context, { timeout: 100 });
    if (typeof result === 'number' || typeof result === 'string') {
      return { blocked: false, output: result };
    }
    return { blocked: false, output: JSON.stringify(result) };
  } catch (err) {
    return {
      blocked: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function baselineExtractMultiHop(question: string, tabs: readonly MultiHopTabFixture[]): string {
  const stopWords = new Set(['what', 'which', 'that', 'this', 'with', 'from', 'for', 'the', 'and', 'are', 'apply']);
  const queryTerms = question
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 3 && !stopWords.has(t));

  const entityTokens = new Set<string>();
  const collectedLines: string[] = [];

  const scoreLine = (line: string): number => {
    const lower = line.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (lower.includes(term)) score += 1;
    }
    for (const ent of entityTokens) {
      if (lower.includes(ent.toLowerCase())) score += 3;
    }
    return score;
  };

  // Pass 1: gather anchor entities from tabs matching initial query terms
  for (const tab of tabs) {
    const lines = tab.text.split(/\r?\n/);
    for (const line of lines) {
      if (scoreLine(line) > 0 || tab.title.toLowerCase().includes('active') || line.toLowerCase().includes('active')) {
        collectedLines.push(line);
        const ids = line.match(/\b(?:ORD-\d+|[a-z]+-[a-z0-9-]+)\b/gi) ?? [];
        for (const id of ids) {
          if (id.length >= 5) entityTokens.add(id);
        }
      }
    }
  }

  // Pass 2: cross-tab hop using discovered entity IDs
  for (const tab of tabs) {
    for (const line of tab.text.split(/\r?\n/)) {
      if (scoreLine(line) >= 2 && !collectedLines.includes(line)) {
        collectedLines.push(line);
      }
    }
  }

  return collectedLines.join('\n');
}

export function createBaselineToolsTarget(): ToolsEvalTarget {
  return {
    distillAom: baselineDistillAom,
    validateToolCall: baselineValidateToolCall,
    runSandbox: baselineRunSandbox,
    extractMultiHop: baselineExtractMultiHop,
  };
}

export async function runToolsSuite(
  target: ToolsEvalTarget = createBaselineToolsTarget(),
  dataset: readonly ToolsEvalCase[] = TOOLS_DATASET,
): Promise<SuiteRunOutput> {
  const cases = [];
  const compressionRatios: number[] = [];
  const schemaF1s: number[] = [];
  let sandboxUnsafeTotal = 0;
  let sandboxUnsafeBlocked = 0;
  let sandboxSafeTotal = 0;
  let sandboxSafeCorrect = 0;
  const multiHopRecalls: number[] = [];

  for (const item of dataset) {
    if (item.kind === 'aom_compression') {
      const { result: aom, latencyMs } = await measureAsync(() => target.distillAom(item.rawHtml, item.url));
      const ratio = computeCompressionRatio(item.rawHtml, aom);
      const savings = computeTokenSavingsRatio(item.rawHtml, aom);
      const lowerAom = aom.toLowerCase();
      const retainedCount = item.requiredSemantics.filter((s) => lowerAom.includes(s.toLowerCase())).length;
      const semanticFidelity = computeRate(retainedCount, item.requiredSemantics.length);
      const ratioScore = Math.min(1, ratio / item.minCompressionRatio);
      const score = 0.7 * semanticFidelity + 0.3 * ratioScore;
      const passed = semanticFidelity === 1 && ratio >= item.minCompressionRatio;
      compressionRatios.push(ratio);
      cases.push(
        makeCaseResult({
          id: item.id,
          suite: 'tools',
          passed,
          score,
          latencyMs,
          metrics: {
            kind: item.kind,
            compressionRatio: roundMetric(ratio, 3),
            tokenSavings: roundMetric(savings, 4),
            semanticFidelity: roundMetric(semanticFidelity, 4),
          },
        }),
      );
    } else if (item.kind === 'schema_validation') {
      let tp = 0;
      let fp = 0;
      let fn = 0;
      let tn = 0;
      const { result: sampleResults, latencyMs } = await measureAsync(async () => {
        const out = [];
        for (const sample of item.samples) {
          out.push(await target.validateToolCall(sample.toolName, sample.arguments));
        }
        return out;
      });
      for (let i = 0; i < item.samples.length; i++) {
        const sample = item.samples[i]!;
        const actual = sampleResults[i]!;
        const canonicalOk =
          !sample.expectValid ||
          sample.expectedCanonicalName === undefined ||
          actual.canonicalName === sample.expectedCanonicalName;
        if (sample.expectValid) {
          if (actual.valid && canonicalOk) tp++;
          else fn++;
        } else {
          if (actual.valid) fp++;
          else tn++;
        }
      }
      const { f1, precision, recall } = computeF1(tp, fp, fn);
      const accuracy = computeRate(tp + tn, item.samples.length);
      const passed = f1 === 1 && accuracy === 1;
      schemaF1s.push(f1);
      cases.push(
        makeCaseResult({
          id: item.id,
          suite: 'tools',
          passed,
          score: f1,
          latencyMs,
          metrics: {
            kind: item.kind,
            f1: roundMetric(f1, 4),
            precision: roundMetric(precision, 4),
            recall: roundMetric(recall, 4),
            accuracy: roundMetric(accuracy, 4),
          },
        }),
      );
    } else if (item.kind === 'sandbox') {
      const { result: sb, latencyMs } = await measureAsync(() => target.runSandbox(item.code));
      let passed = false;
      let score = 0;
      if (item.expectBlocked) {
        sandboxUnsafeTotal++;
        if (sb.blocked) {
          sandboxUnsafeBlocked++;
          passed = true;
          score = 1;
        }
      } else {
        sandboxSafeTotal++;
        const exactMatch = !sb.blocked && String(sb.output) === String(item.expectedOutput);
        if (exactMatch) {
          sandboxSafeCorrect++;
          passed = true;
          score = 1;
        }
      }
      cases.push(
        makeCaseResult({
          id: item.id,
          suite: 'tools',
          passed,
          score,
          latencyMs,
          metrics: {
            kind: item.kind,
            blocked: sb.blocked,
            expectBlocked: item.expectBlocked,
          },
        }),
      );
    } else {
      const { result: extracted, latencyMs } = await measureAsync(() =>
        target.extractMultiHop(item.question, item.tabs),
      );
      const lower = extracted.toLowerCase();
      const hits = item.expectedFacts.filter((f) => lower.includes(f.toLowerCase())).length;
      const recall = computeRate(hits, item.expectedFacts.length);
      multiHopRecalls.push(recall);
      cases.push(
        makeCaseResult({
          id: item.id,
          suite: 'tools',
          passed: recall === 1,
          score: recall,
          latencyMs,
          metrics: {
            kind: item.kind,
            extractionRecall: roundMetric(recall, 4),
            factsFound: hits,
            factsTotal: item.expectedFacts.length,
          },
        }),
      );
    }
  }

  const suiteMetrics: Record<string, number> = {
    aomCompressionRatio: roundMetric(mean(compressionRatios), 3),
    schemaValidationF1: roundMetric(mean(schemaF1s), 4),
    sandboxSafetyRate: roundMetric(
      sandboxUnsafeTotal === 0 ? 1 : computeRate(sandboxUnsafeBlocked, sandboxUnsafeTotal),
      4,
    ),
    sandboxAccuracy: roundMetric(
      sandboxSafeTotal === 0 ? 1 : computeRate(sandboxSafeCorrect, sandboxSafeTotal),
      4,
    ),
    multiHopRecall: roundMetric(mean(multiHopRecalls), 4),
  };

  return {
    suite: 'tools',
    cases,
    suiteMetrics,
    aggregateScore: roundMetric(mean(cases.map((c) => c.score)), 4),
  };
}

export type { AomCompressionCase, MultiHopCase, SandboxCase, SchemaValidationCase };
