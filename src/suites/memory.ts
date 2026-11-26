import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type {
  HarnessMessage,
  MemoryHit,
  MemoryProvider,
  MemoryQuery,
  MemoryRecord,
  MemoryRecordInput,
  MemoryTier,
} from '../contracts.js';
import {
  MEMORY_DATASET,
  type MemoryCorpusItem,
  type MemoryEvalCase,
} from '../datasets/memory.js';
import {
  computeRate,
  mean,
  meanReciprocalRank,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  roundMetric,
} from '../metrics.js';
import { makeCaseResult, measureAsync, type SuiteRunOutput } from './common.js';

export type MemoryProviderFactory = () => Promise<MemoryProvider> | MemoryProvider;

const SENSITIVE_URL_PATTERNS: readonly RegExp[] = [
  /(?:bank|banking|chasebank|wellsfargo|bankofamerica|citibank)/i,
  /(?:accounts\.google\.com|\/signin|\/login|\/oauth\/|\/auth\/)/i,
  /(?:access_token=|id_token=|refresh_token=|api_key=|secret=)/i,
];

const SENSITIVE_CONTENT_PATTERNS: readonly RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\bsecret_live_[a-z0-9]+\b/i,
  /\brouting\s+number\b/i,
  /\brecovery\s+password\b/i,
];

const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['drink', 'beverage', 'coffee', 'espresso', 'latte', 'tea'],
  ['favorite', 'preferred', 'primary', 'ritual', 'habit'],
  ['editor', 'ide', 'neovim', 'vim', 'vscode', 'workspace'],
  ['code', 'coding', 'programming', 'developer', 'software'],
  ['address', 'shipping', 'home', 'residence'],
  ['endpoint', 'url', 'manifest', 'api'],
];

const SYNONYM_MAP = new Map<string, Set<string>>();
for (const group of SYNONYM_GROUPS) {
  const set = new Set(group);
  for (const term of group) {
    SYNONYM_MAP.set(term, set);
  }
}

const TIER_HALF_LIFE_DAYS: Record<MemoryTier, number> = {
  working: 7,
  episodic: 21,
  document: 90,
  profile: 365,
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2);
}

function expandWithSynonyms(tokens: readonly string[]): Set<string> {
  const expanded = new Set<string>(tokens);
  for (const t of tokens) {
    const syns = SYNONYM_MAP.get(t);
    if (syns) {
      for (const s of syns) expanded.add(s);
    }
  }
  return expanded;
}

export function isSensitiveMemoryInput(input: MemoryRecordInput): boolean {
  if (input.sourceUrl) {
    for (const pattern of SENSITIVE_URL_PATTERNS) {
      if (pattern.test(input.sourceUrl)) return true;
    }
  }
  for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
    if (pattern.test(input.content)) return true;
  }
  return false;
}

export function createBaselineMemoryProvider(nowProvider: () => number = () => Date.now()): MemoryProvider {
  let seq = 1;
  const records = new Map<string, MemoryRecord>();

  return {
    async remember(input: MemoryRecordInput): Promise<MemoryRecord> {
      if (isSensitiveMemoryInput(input)) {
        throw new Error('Rejected sensitive domain or credential content from local memory.');
      }
      const now = nowProvider();
      const id = `mem-${seq++}`;
      if (input.supersedesId) {
        const old = records.get(input.supersedesId);
        if (old) {
          old.supersededById = id;
          old.updatedAt = now;
        }
      }
      const record: MemoryRecord = {
        ...input,
        id,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      };
      records.set(id, record);
      return record;
    },

    async recall(query: MemoryQuery): Promise<MemoryHit[]> {
      const nowMs = query.nowMs ?? nowProvider();
      const qTokens = tokenize(query.query);
      const qExpanded = expandWithSynonyms(qTokens);
      const limit = query.limit ?? 10;
      const minScore = query.minScore ?? 0.05;

      const hits: MemoryHit[] = [];
      for (const record of records.values()) {
        if (record.supersededById !== undefined) continue;
        if (query.tiers && !query.tiers.includes(record.tier)) continue;

        const docTokens = tokenize(`${record.content} ${(record.tags ?? []).join(' ')}`);
        const docSet = new Set(docTokens);

        let exactOverlap = 0;
        for (const qt of qTokens) {
          if (docSet.has(qt)) exactOverlap++;
        }
        let synonymOverlap = 0;
        for (const qe of qExpanded) {
          if (docSet.has(qe)) synonymOverlap++;
        }

        const bm25Like =
          qTokens.length === 0
            ? 0
            : (exactOverlap * 1.5 + Math.max(0, synonymOverlap - exactOverlap) * 0.85) /
              (qTokens.length + 0.5);

        if (bm25Like <= 0) continue;

        const ageDays = Math.max(0, (nowMs - record.updatedAt) / 86_400_000);
        const halfLife = TIER_HALF_LIFE_DAYS[record.tier];
        const recencyWeight = Math.exp((-Math.LN2 * ageDays) / halfLife);
        const importanceBoost = 0.7 + 0.45 * (record.importance ?? 0.5);
        const score = bm25Like * (0.45 + 0.55 * recencyWeight) * importanceBoost;

        if (score >= minScore) {
          hits.push({
            record,
            score,
            bm25Rank: bm25Like,
            recencyWeight,
          });
        }
      }

      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, limit);
    },

    async consolidate(threadId: string, messages: HarnessMessage[]) {
      let added = 0;
      for (const msg of messages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          if (!isSensitiveMemoryInput({ tier: 'episodic', content: msg.content })) {
            await this.remember({ tier: 'episodic', content: msg.content, threadId });
            added++;
          }
        }
      }
      return { added, superseded: 0 };
    },

    async inspect(filter) {
      const all = Array.from(records.values()).filter((r) => !filter?.tier || r.tier === filter.tier);
      const offset = filter?.offset ?? 0;
      const limit = filter?.limit ?? all.length;
      return all.slice(offset, offset + limit);
    },

    async forget(id: string): Promise<boolean> {
      return records.delete(id);
    },

    async exportEncrypted(passphrase: string): Promise<Uint8Array> {
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const key = scryptSync(passphrase, salt, 32);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const payload = Buffer.from(JSON.stringify(Array.from(records.values())), 'utf8');
      const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([salt, iv, tag, encrypted]);
    },

    async importEncrypted(blob: Uint8Array, passphrase: string) {
      const buf = Buffer.from(blob);
      const salt = buf.subarray(0, 16);
      const iv = buf.subarray(16, 28);
      const tag = buf.subarray(28, 44);
      const ciphertext = buf.subarray(44);
      const key = scryptSync(passphrase, salt, 32);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      const items = JSON.parse(plain) as MemoryRecord[];
      for (const item of items) {
        records.set(item.id, item);
      }
      return { imported: items.length };
    },

    async wipeAll(): Promise<void> {
      records.clear();
    },
  };
}

async function seedCorpus(
  provider: MemoryProvider,
  items: readonly MemoryCorpusItem[],
  nowMs: number,
  setClock?: (ts: number) => void,
): Promise<Map<string, string>> {
  const providerWithClock = provider as MemoryProvider & { setClock?: (ts: number) => void };
  const effectiveSetClock =
    setClock ?? (typeof providerWithClock.setClock === 'function' ? (ts: number) => providerWithClock.setClock!(ts) : undefined);
  const fixtureToId = new Map<string, string>();
  const idToFixture = new Map<string, string>();
  for (const item of items) {
    const ts = nowMs - (item.ageDays ?? 0) * 86_400_000;
    effectiveSetClock?.(ts);
    const supersedesId = item.supersedesFixtureId
      ? fixtureToId.get(item.supersedesFixtureId)
      : undefined;
    const saved = await provider.remember({
      tier: item.tier,
      content: item.content,
      sourceUrl: item.sourceUrl,
      sourceTitle: item.sourceTitle,
      threadId: item.threadId,
      tags: item.tags,
      importance: item.importance,
      tainted: item.tainted,
      supersedesId,
    });
    // Backdate baseline timestamps if provider used Date.now() instead of injected clock
    if (!effectiveSetClock && item.ageDays) {
      saved.createdAt = ts;
      saved.updatedAt = ts;
      saved.lastAccessedAt = ts;
    }
    fixtureToId.set(item.fixtureId, saved.id);
    idToFixture.set(saved.id, item.fixtureId);
  }
  effectiveSetClock?.(nowMs);
  return idToFixture;
}

export async function runMemorySuite(
  providerFactory: MemoryProviderFactory = () => createBaselineMemoryProvider(),
  dataset: readonly MemoryEvalCase[] = MEMORY_DATASET,
): Promise<SuiteRunOutput> {
  const cases = [];
  const pAtKValues: number[] = [];
  const rAtKValues: number[] = [];
  const mrrValues: number[] = [];
  const ndcgValues: number[] = [];
  const supersedingScores: number[] = [];
  const decayScores: number[] = [];
  let sensitiveTotal = 0;
  let sensitiveLeaks = 0;

  for (const item of dataset) {
    const provider = await providerFactory();
    try {
      if (item.kind === 'retrieval') {
        const idToFixture = await seedCorpus(provider, item.corpus, item.nowMs);
        const { result: hits, latencyMs } = await measureAsync(() =>
          provider.recall({ query: item.query, limit: item.k, nowMs: item.nowMs }),
        );
        const rankedFixtureIds = hits
          .map((h) => idToFixture.get(h.record.id) ?? h.record.id);
        const relevantSet = new Set(item.relevantFixtureIds);
        const gradesMap = new Map(Object.entries(item.relevanceGrades));

        const p = precisionAtK(rankedFixtureIds, relevantSet, item.k);
        const r = recallAtK(rankedFixtureIds, relevantSet, item.k);
        const mrr = meanReciprocalRank(rankedFixtureIds, relevantSet);
        const ndcg = ndcgAtK(rankedFixtureIds, gradesMap, item.k);

        pAtKValues.push(p);
        rAtKValues.push(r);
        mrrValues.push(mrr);
        ndcgValues.push(ndcg);

        const score = 0.25 * p + 0.25 * r + 0.25 * mrr + 0.25 * ndcg;
        const passed = r >= 1 && mrr >= 0.5 && ndcg >= 0.75;
        cases.push(
          makeCaseResult({
            id: item.id,
            suite: 'memory',
            passed,
            score,
            latencyMs,
            metrics: {
              kind: item.kind,
              precisionAtK: roundMetric(p, 4),
              recallAtK: roundMetric(r, 4),
              mrr: roundMetric(mrr, 4),
              ndcgAtK: roundMetric(ndcg, 4),
            },
          }),
        );
      } else if (item.kind === 'superseding') {
        const allItems = [...item.initialRecords, item.supersedingRecord];
        const idToFixture = await seedCorpus(provider, allItems, item.nowMs);
        const { result: hits, latencyMs } = await measureAsync(() =>
          provider.recall({ query: item.query, limit: 5, nowMs: item.nowMs }),
        );
        const rankedFixtureIds = hits.map((h) => idToFixture.get(h.record.id) ?? h.record.id);
        const topIsLatest = rankedFixtureIds[0] === item.expectedLatestFixtureId;
        const staleReturned = rankedFixtureIds.some((id) => item.forbiddenStaleFixtureIds.includes(id));
        const ok = topIsLatest && !staleReturned;
        supersedingScores.push(ok ? 1 : 0);
        cases.push(
          makeCaseResult({
            id: item.id,
            suite: 'memory',
            passed: ok,
            score: ok ? 1 : 0,
            latencyMs,
            metrics: {
              kind: item.kind,
              topIsLatest,
              staleReturned,
            },
          }),
        );
      } else if (item.kind === 'temporal_decay') {
        const idToFixture = await seedCorpus(provider, item.corpus, item.nowMs);
        const { result: hits, latencyMs } = await measureAsync(() =>
          provider.recall({ query: item.query, limit: 5, nowMs: item.nowMs }),
        );
        const rankedFixtureIds = hits.map((h) => idToFixture.get(h.record.id) ?? h.record.id);
        const ok = rankedFixtureIds[0] === item.expectedTopFixtureId;
        decayScores.push(ok ? 1 : 0);
        cases.push(
          makeCaseResult({
            id: item.id,
            suite: 'memory',
            passed: ok,
            score: ok ? 1 : 0,
            latencyMs,
            metrics: {
              kind: item.kind,
              topFixtureId: rankedFixtureIds[0] ?? 'none',
              expectedTopFixtureId: item.expectedTopFixtureId,
            },
          }),
        );
      } else {
        const { result: audit, latencyMs } = await measureAsync(async () => {
          const sensitiveStoredIds = new Set<string>();
          let sensitiveRejected = 0;
          let sensitiveCount = 0;
          let safeStored = 0;
          let safeCount = 0;

          for (const candidate of item.candidateInputs) {
            if (candidate.isSensitive) {
              sensitiveCount++;
              try {
                const rec = await provider.remember(candidate.record);
                sensitiveStoredIds.add(rec.id);
              } catch {
                sensitiveRejected++;
              }
            } else {
              safeCount++;
              try {
                await provider.remember(candidate.record);
                safeStored++;
              } catch {
                // false rejection of benign record
              }
            }
          }

          let leakedHits = 0;
          for (const q of item.probeQueries) {
            const hits = await provider.recall({ query: q, limit: 10 });
            for (const h of hits) {
              if (sensitiveStoredIds.has(h.record.id)) {
                leakedHits++;
              }
            }
          }

          return { sensitiveRejected, sensitiveCount, leakedHits, safeStored, safeCount };
        });

        sensitiveTotal += audit.sensitiveCount;
        if (audit.leakedHits > 0) {
          sensitiveLeaks += Math.min(audit.sensitiveCount, audit.leakedHits);
        }
        const leakRate = computeRate(audit.leakedHits, Math.max(1, audit.sensitiveCount));
        const benignSaveRate = computeRate(audit.safeStored, Math.max(1, audit.safeCount));
        const passed = audit.leakedHits === 0 && audit.safeStored === audit.safeCount;
        const score = passed ? 1 : Math.max(0, 1 - leakRate) * benignSaveRate;
        cases.push(
          makeCaseResult({
            id: item.id,
            suite: 'memory',
            passed,
            score,
            latencyMs,
            metrics: {
              kind: item.kind,
              sensitiveLeakRate: roundMetric(leakRate, 4),
              sensitiveRejected: audit.sensitiveRejected,
              benignSaved: audit.safeStored,
            },
          }),
        );
      }
    } finally {
      await provider.wipeAll();
    }
  }

  const suiteMetrics: Record<string, number> = {
    precisionAtK: roundMetric(mean(pAtKValues), 4),
    recallAtK: roundMetric(mean(rAtKValues), 4),
    mrr: roundMetric(mean(mrrValues), 4),
    ndcgAtK: roundMetric(mean(ndcgValues), 4),
    supersedingAccuracy: roundMetric(mean(supersedingScores), 4),
    temporalDecayAccuracy: roundMetric(mean(decayScores), 4),
    sensitiveDomainLeakRate: roundMetric(
      sensitiveTotal === 0 ? 0 : computeRate(sensitiveLeaks, sensitiveTotal),
      4,
    ),
  };

  return {
    suite: 'memory',
    cases,
    suiteMetrics,
    aggregateScore: roundMetric(mean(cases.map((c) => c.score)), 4),
  };
}
