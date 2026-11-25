import type { ConcreteSuiteName, EvalCaseResult, EvalScorecard, EvalSuiteName } from './contracts.js';
import { mean, roundMetric } from './metrics.js';
import type { SuiteRunOutput } from './suites/common.js';
import { runGuardSuite, type GuardEvalTarget } from './suites/guard.js';
import { runHarnessSuite, type HarnessEvalTarget } from './suites/harness.js';
import { runMemorySuite, type MemoryProviderFactory } from './suites/memory.js';
import { runToolsSuite, type ToolsEvalTarget } from './suites/tools.js';
import { runVoiceSuite, type VoiceEvalTarget } from './suites/voice.js';

export const CONCRETE_SUITES: readonly ConcreteSuiteName[] = [
  'tools',
  'harness',
  'memory',
  'guard',
  'voice',
];

export interface EvalTargets {
  tools?: ToolsEvalTarget;
  harness?: HarnessEvalTarget;
  memory?: MemoryProviderFactory;
  guard?: GuardEvalTarget;
  voice?: VoiceEvalTarget;
}

export interface RunSuiteOptions {
  targets?: EvalTargets;
  timestampIso?: string;
}

async function runSingleSuite(
  suite: ConcreteSuiteName,
  targets: EvalTargets,
): Promise<SuiteRunOutput> {
  switch (suite) {
    case 'tools':
      return runToolsSuite(targets.tools);
    case 'harness':
      return runHarnessSuite(targets.harness);
    case 'memory':
      return runMemorySuite(targets.memory);
    case 'guard':
      return runGuardSuite(targets.guard);
    case 'voice':
      return runVoiceSuite(targets.voice);
  }
}

export async function runSuite(
  suite: EvalSuiteName = 'all',
  options: RunSuiteOptions = {},
): Promise<EvalScorecard> {
  const targets = options.targets ?? {};
  const suitesToRun: readonly ConcreteSuiteName[] =
    suite === 'all' ? CONCRETE_SUITES : [suite];

  const outputs: SuiteRunOutput[] = [];
  for (const s of suitesToRun) {
    outputs.push(await runSingleSuite(s, targets));
  }

  const cases: EvalCaseResult[] = outputs.flatMap((o) => o.cases);
  const passed = cases.filter((c) => c.passed).length;
  const total = cases.length;
  const failed = total - passed;
  const aggregateScore = roundMetric(mean(cases.map((c) => c.score)), 4);

  const suiteMetrics: Record<string, number> = {};
  if (suite === 'all') {
    for (const out of outputs) {
      suiteMetrics[`${out.suite}.aggregateScore`] = out.aggregateScore;
      for (const [k, v] of Object.entries(out.suiteMetrics)) {
        suiteMetrics[`${out.suite}.${k}`] = v;
      }
    }
  } else {
    const single = outputs[0];
    if (single) {
      Object.assign(suiteMetrics, single.suiteMetrics);
    }
  }

  return {
    schemaVersion: 1,
    suite,
    timestampIso: options.timestampIso ?? new Date().toISOString(),
    summary: {
      total,
      passed,
      failed,
      aggregateScore,
      suiteMetrics,
    },
    cases,
  };
}
