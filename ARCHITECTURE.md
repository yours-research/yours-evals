# Architecture — `@yours/evals`

`@yours/evals` is structured into five clean layers with zero external runtime dependencies and strict adherence to [`docs/ECOSYSTEM_CONTRACTS.md`](./docs/ECOSYSTEM_CONTRACTS.md).

## Directory Layout

- `src/contracts.ts` — Canonical TypeScript interfaces mirrored from `ECOSYSTEM_CONTRACTS.md` (`ToolDefinition`, `RuntimeAdapter`, `MemoryProvider`, `SanitizedContent`, `GuardDecision`, `VoicePipeline`, `EvalCaseResult`, `EvalScorecard`).
- `src/metrics.ts` — Pure mathematical evaluators: token estimation, compression ratios, F1, Precision@K, Recall@K, MRR, NDCG@K, and KV-cache prefix reuse ratio.
- `src/datasets/` — Deterministic fixture suites (`tools.ts`, `harness.ts`, `memory.ts`, `guard.ts`, `voice.ts`). All datasets run offline with zero network calls.
- `src/suites/` — Suite runners and built-in deterministic baseline evaluators:
  - `tools.ts`: HTML-to-AOM distillation, Schema v1.1 + legacy alias validator, `node:vm` frozen sandbox, and cross-tab multi-hop extractor.
  - `harness.ts`: Entity-weighted context compactor, stateful prefix-slot `RuntimeAdapter`, chunked malformed-JSON repair parser, and `AbortSignal` stream cancellation.
  - `memory.ts`: Hybrid TF-IDF + synonym-expansion `MemoryProvider` with tier-aware temporal decay, `supersedesId` suppression, AES-256-GCM export/import, and sensitive-domain blocking.
  - `guard.ts`: IDPI sanitizer (hidden CSS, zero-width/bidi/tag Unicode, hidden SVG/`foreignObject`, `#HashJack`, fake chat/tool delimiters) and Lethal Trifecta policy engine.
  - `voice.ts`: Abbreviation-aware streaming sentence chunker, pre-roll VAD segmenter, and abortable `VoicePipeline` for barge-in SLA verification.
- `src/runner.ts` — Orchestrates single-suite or `all` execution, producing a schema-versioned `EvalScorecard`.
- `src/compare.ts` — Polarity-aware regression gate (`compareScorecards`) distinguishing higher-is-better scores, lower-is-better error rates (`attackSuccessRate`, `falsePositiveRate`, `sensitiveDomainLeakRate`, `vadOnsetClippingRate`), and latency budgets.
- `src/reporters/` — JSON and GitHub Step Summary / PR-compatible Markdown formatters.
- `src/cli.ts` — Executable CLI (`yours-evals`) supporting `--suite`, `--format`, `--out-json`, `--out-md`, `--baseline`, `--max-regression`, and `--fail-on-case-failure`.

## Pluggability Model

Every suite runner accepts an optional target implementation (or factory for stateful `MemoryProvider` tests) matching the shared ecosystem contracts. When omitted, the suite runs against its deterministic built-in baseline evaluator, ensuring CI stays fast and self-contained while external sibling packages can validate drop-in compliance directly.
