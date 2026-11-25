#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareScorecards, type ScorecardComparisonResult } from './compare.js';
import type { EvalScorecard, EvalSuiteName } from './contracts.js';
import { formatScorecardJson } from './reporters/json.js';
import { formatScorecardMarkdown } from './reporters/markdown.js';
import { runSuite } from './runner.js';

export interface ParsedCliArgs {
  suite: EvalSuiteName;
  format: 'markdown' | 'json' | 'both';
  outJson?: string;
  outMd?: string;
  baseline?: string;
  maxRegression: number;
  failOnCaseFailure: boolean;
  help: boolean;
  version: boolean;
}

const VALID_SUITES = new Set<EvalSuiteName>([
  'tools',
  'harness',
  'memory',
  'guard',
  'voice',
  'all',
]);

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = {
    suite: 'all',
    format: 'markdown',
    maxRegression: 0.02,
    failOnCaseFailure: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--version' || arg === '-v') {
      parsed.version = true;
    } else if (arg === '--fail-on-case-failure') {
      parsed.failOnCaseFailure = true;
    } else if (arg === '--suite' || arg === '-s') {
      const val = argv[++i] as EvalSuiteName | undefined;
      if (!val || !VALID_SUITES.has(val)) {
        throw new Error(`Invalid --suite value "${val ?? ''}". Expected one of: tools, harness, memory, guard, voice, all.`);
      }
      parsed.suite = val;
    } else if (arg === '--format' || arg === '-f') {
      const val = argv[++i];
      if (val !== 'markdown' && val !== 'json' && val !== 'both') {
        throw new Error(`Invalid --format value "${val ?? ''}". Expected markdown, json, or both.`);
      }
      parsed.format = val;
    } else if (arg === '--out-json') {
      const val = argv[++i];
      if (!val) throw new Error('Missing path after --out-json');
      parsed.outJson = val;
    } else if (arg === '--out-md') {
      const val = argv[++i];
      if (!val) throw new Error('Missing path after --out-md');
      parsed.outMd = val;
    } else if (arg === '--baseline' || arg === '-b') {
      const val = argv[++i];
      if (!val) throw new Error('Missing path after --baseline');
      parsed.baseline = val;
    } else if (arg === '--max-regression') {
      const raw = argv[++i];
      const num = Number(raw);
      if (!raw || !Number.isFinite(num) || num < 0) {
        throw new Error(`Invalid --max-regression value "${raw ?? ''}"`);
      }
      parsed.maxRegression = num;
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  return parsed;
}

const HELP_TEXT = `yours-evals — Cross-stack benchmark & regression gate for @yours/*

Usage:
  yours-evals [options]

Options:
  -s, --suite <name>          Suite to run: tools|harness|memory|guard|voice|all (default: all)
  -f, --format <fmt>          Stdout format: markdown|json|both (default: markdown)
      --out-json <path>       Write EvalScorecard JSON to file
      --out-md <path>         Write Markdown scorecard to file
  -b, --baseline <path>       Compare against baseline EvalScorecard JSON file
      --max-regression <num>  Max allowed metric regression vs baseline (default: 0.02)
      --fail-on-case-failure  Exit 1 if any eval case fails
  -h, --help                  Show this help message
  -v, --version               Print package version
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  },
): Promise<number> {
  let args: ParsedCliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    io.stderr(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  if (args.help) {
    io.stdout(HELP_TEXT);
    return 0;
  }
  if (args.version) {
    io.stdout('0.1.0\n');
    return 0;
  }

  const scorecard = await runSuite(args.suite);
  let comparison: ScorecardComparisonResult | undefined;

  if (args.baseline) {
    const baselineRaw = await readFile(resolve(args.baseline), 'utf8');
    const baseline = JSON.parse(baselineRaw) as EvalScorecard;
    comparison = compareScorecards(baseline, scorecard, args.maxRegression);
  }

  const jsonText = formatScorecardJson(scorecard, true);
  const mdText = formatScorecardMarkdown(scorecard, comparison);

  if (args.outJson) {
    const targetPath = resolve(args.outJson);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${jsonText}\n`, 'utf8');
  }
  if (args.outMd) {
    const targetPath = resolve(args.outMd);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${mdText}\n`, 'utf8');
  }

  if (args.format === 'json') {
    io.stdout(`${jsonText}\n`);
  } else if (args.format === 'both') {
    io.stdout(`${mdText}\n\n${jsonText}\n`);
  } else {
    io.stdout(`${mdText}\n`);
  }

  if (args.failOnCaseFailure && scorecard.summary.failed > 0) {
    io.stderr(`Eval failed: ${scorecard.summary.failed} case(s) did not pass.\n`);
    return 1;
  }

  if (comparison && !comparison.passed) {
    io.stderr(
      `Regression gate failed: ${comparison.regressions.length} metric(s) regressed beyond ${args.maxRegression}.\n`,
    );
    return 1;
  }

  return 0;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`Fatal error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exitCode = 1;
    },
  );
}
