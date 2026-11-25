import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { EvalScorecard } from '../src/contracts.js';
import { parseCliArgs, runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

describe('yours-evals CLI', () => {
  it('parses valid CLI arguments and rejects invalid flags', () => {
    const parsed = parseCliArgs([
      '--suite',
      'guard',
      '--format',
      'json',
      '--max-regression',
      '0.05',
      '--fail-on-case-failure',
    ]);
    expect(parsed.suite).toBe('guard');
    expect(parsed.format).toBe('json');
    expect(parsed.maxRegression).toBe(0.05);
    expect(parsed.failOnCaseFailure).toBe(true);

    expect(() => parseCliArgs(['--suite', 'invalid'])).toThrow();
    expect(() => parseCliArgs(['--unknown'])).toThrow();
  });

  it('executes runCli writing JSON/Markdown artifacts and enforcing baseline regression gate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'yours-evals-cli-'));
    try {
      const jsonPath = join(dir, 'scorecard.json');
      const mdPath = join(dir, 'scorecard.md');
      let stdout = '';
      let stderr = '';

      const exitCode = await runCli(
        ['--suite', 'tools', '--format', 'json', '--out-json', jsonPath, '--out-md', mdPath, '--fail-on-case-failure'],
        {
          stdout: (t) => {
            stdout += t;
          },
          stderr: (t) => {
            stderr += t;
          },
        },
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      const parsedOut = JSON.parse(stdout) as EvalScorecard;
      expect(parsedOut.suite).toBe('tools');
      expect(parsedOut.summary.failed).toBe(0);

      const savedJson = JSON.parse(await readFile(jsonPath, 'utf8')) as EvalScorecard;
      expect(savedJson.summary.total).toBe(parsedOut.summary.total);
      const savedMd = await readFile(mdPath, 'utf8');
      expect(savedMd).toContain('@yours/evals Scorecard');

      // Create an artificially superior baseline so current fails regression gate
      const strictBaseline = structuredClone(savedJson);
      strictBaseline.summary.aggregateScore = 1;
      strictBaseline.summary.suiteMetrics['schemaValidationF1'] = 1;
      strictBaseline.summary.suiteMetrics['aomCompressionRatio'] = 999;
      const baselinePath = join(dir, 'strict-baseline.json');
      await writeFile(baselinePath, JSON.stringify(strictBaseline, null, 2), 'utf8');

      let regStderr = '';
      const regExit = await runCli(
        ['--suite', 'tools', '--baseline', baselinePath, '--max-regression', '0.02'],
        {
          stdout: () => {},
          stderr: (t) => {
            regStderr += t;
          },
        },
      );
      expect(regExit).toBe(1);
      expect(regStderr).toContain('Regression gate failed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runs compiled dist/cli.js binary cleanly when built', async () => {
    const distCli = resolve(process.cwd(), 'dist/cli.js');
    if (!existsSync(distCli)) return;

    const { stdout } = await execFileAsync(process.execPath, [
      distCli,
      '--suite',
      'guard',
      '--format',
      'json',
      '--fail-on-case-failure',
    ]);
    const scorecard = JSON.parse(stdout) as EvalScorecard;
    expect(scorecard.suite).toBe('guard');
    expect(scorecard.summary.failed).toBe(0);
  });
});
