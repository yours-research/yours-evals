import type { MemoryRecordInput } from '../contracts.js';

export interface MemoryCorpusItem extends MemoryRecordInput {
  fixtureId: string;
  ageDays?: number;
  relevance?: number; // 0..3 for NDCG
  supersedesFixtureId?: string;
}

export interface MemoryRetrievalCase {
  kind: 'retrieval';
  id: string;
  description: string;
  corpus: MemoryCorpusItem[];
  query: string;
  k: number;
  relevantFixtureIds: string[];
  relevanceGrades: Record<string, number>;
  nowMs: number;
}

export interface MemorySupersedingCase {
  kind: 'superseding';
  id: string;
  description: string;
  initialRecords: MemoryCorpusItem[];
  supersedingRecord: MemoryCorpusItem;
  query: string;
  expectedLatestFixtureId: string;
  forbiddenStaleFixtureIds: string[];
  nowMs: number;
}

export interface MemoryTemporalDecayCase {
  kind: 'temporal_decay';
  id: string;
  description: string;
  corpus: MemoryCorpusItem[];
  query: string;
  expectedTopFixtureId: string;
  nowMs: number;
}

export interface MemorySensitiveDomainCase {
  kind: 'sensitive_domain';
  id: string;
  description: string;
  candidateInputs: Array<{
    fixtureId: string;
    record: MemoryRecordInput;
    isSensitive: boolean;
  }>;
  probeQueries: string[];
}

export type MemoryEvalCase =
  | MemoryRetrievalCase
  | MemorySupersedingCase
  | MemoryTemporalDecayCase
  | MemorySensitiveDomainCase;

const BASE_NOW_MS = 1_764_000_000_000;

export const MEMORY_DATASET: readonly MemoryEvalCase[] = [
  {
    kind: 'retrieval',
    id: 'memory-retrieval-exact-profile',
    description: 'Retrieve exact keyword matches across profile and episodic memory.',
    nowMs: BASE_NOW_MS,
    k: 3,
    query: 'typescript vitest framework preference',
    relevantFixtureIds: ['m1', 'm2'],
    relevanceGrades: { m1: 3, m2: 2 },
    corpus: [
      {
        fixtureId: 'm1',
        tier: 'profile',
        content: 'User prefers TypeScript strict mode and Vitest as the primary test framework.',
        tags: ['typescript', 'vitest', 'testing'],
        importance: 0.95,
        ageDays: 2,
      },
      {
        fixtureId: 'm2',
        tier: 'episodic',
        content: 'Configured Vitest coverage thresholds for the @yours/tools TypeScript package.',
        tags: ['vitest', 'coverage'],
        importance: 0.7,
        ageDays: 5,
      },
      {
        fixtureId: 'm3',
        tier: 'episodic',
        content: 'Ordered replacement mechanical keyboard switches from vendor.',
        tags: ['hardware'],
        importance: 0.4,
        ageDays: 10,
      },
      {
        fixtureId: 'm4',
        tier: 'document',
        content: 'PostgreSQL vacuum tuning guide for large append-only tables.',
        tags: ['postgres'],
        importance: 0.5,
        ageDays: 14,
      },
    ],
  },
  {
    kind: 'retrieval',
    id: 'memory-retrieval-paraphrase-beverage',
    description: 'Match paraphrased query ("favorite hot morning drink") via semantic synonym expansion.',
    nowMs: BASE_NOW_MS,
    k: 3,
    query: 'what is the user favorite hot morning drink',
    relevantFixtureIds: ['bev-1'],
    relevanceGrades: { 'bev-1': 3 },
    corpus: [
      {
        fixtureId: 'bev-1',
        tier: 'profile',
        content: 'Daily morning beverage ritual: double-shot oat milk espresso, no sugar.',
        tags: ['coffee', 'espresso', 'preference'],
        importance: 0.9,
        ageDays: 4,
      },
      {
        fixtureId: 'bev-2',
        tier: 'episodic',
        content: 'Booked evening train ticket from Boston to New York.',
        tags: ['travel'],
        importance: 0.6,
        ageDays: 1,
      },
      {
        fixtureId: 'bev-3',
        tier: 'document',
        content: 'Coolant fluid specification for industrial CNC spindle.',
        tags: ['machining'],
        importance: 0.3,
        ageDays: 20,
      },
    ],
  },
  {
    kind: 'retrieval',
    id: 'memory-retrieval-paraphrase-editor',
    description: 'Match paraphrased query ("preferred code IDE setup") to Neovim + terminal workflow.',
    nowMs: BASE_NOW_MS,
    k: 3,
    query: 'preferred code editor and IDE setup',
    relevantFixtureIds: ['ed-1', 'ed-2'],
    relevanceGrades: { 'ed-1': 3, 'ed-2': 2 },
    corpus: [
      {
        fixtureId: 'ed-1',
        tier: 'profile',
        content: 'Primary programming workspace uses Neovim with LazyVim keybindings and tmux.',
        tags: ['neovim', 'ide', 'coding'],
        importance: 0.92,
        ageDays: 3,
      },
      {
        fixtureId: 'ed-2',
        tier: 'episodic',
        content: 'Updated Neovim LSP config to attach typescript-language-server automatically.',
        tags: ['neovim', 'lsp'],
        importance: 0.75,
        ageDays: 6,
      },
      {
        fixtureId: 'ed-3',
        tier: 'working',
        content: 'Grocery list: avocados, sourdough bread, olive oil.',
        tags: ['errands'],
        importance: 0.2,
        ageDays: 1,
      },
    ],
  },
  {
    kind: 'retrieval',
    id: 'memory-retrieval-graded-ndcg',
    description: 'Rank highly relevant WebGPU quantization architecture doc above tangentially related notes.',
    nowMs: BASE_NOW_MS,
    k: 4,
    query: 'WebGPU q4f16 quantization subgroup kernel throughput',
    relevantFixtureIds: ['wg-1', 'wg-2', 'wg-3'],
    relevanceGrades: { 'wg-1': 3, 'wg-2': 2, 'wg-3': 1 },
    corpus: [
      {
        fixtureId: 'wg-3',
        tier: 'episodic',
        content: 'Tested browser GPU adapter limits on Windows laptop.',
        tags: ['webgpu'],
        importance: 0.5,
        ageDays: 7,
      },
      {
        fixtureId: 'wg-2',
        tier: 'document',
        content: 'WebGPU q4f16 dequantization benchmark notes showing 48 tok/s throughput.',
        tags: ['webgpu', 'quantization'],
        importance: 0.8,
        ageDays: 3,
      },
      {
        fixtureId: 'wg-1',
        tier: 'document',
        content: 'WebGPU q4f16 subgroup matmul kernel design achieves peak memory bandwidth throughput.',
        tags: ['webgpu', 'q4f16', 'subgroup', 'kernel'],
        importance: 0.95,
        ageDays: 1,
      },
      {
        fixtureId: 'wg-distractor',
        tier: 'episodic',
        content: 'Renewed domain registration for personal photography portfolio.',
        tags: ['dns'],
        importance: 0.4,
        ageDays: 2,
      },
    ],
  },
  {
    kind: 'superseding',
    id: 'memory-supersede-address',
    description: 'Return newest shipping address and exclude superseded former address.',
    nowMs: BASE_NOW_MS,
    query: 'current home shipping address',
    expectedLatestFixtureId: 'addr-new',
    forbiddenStaleFixtureIds: ['addr-old'],
    initialRecords: [
      {
        fixtureId: 'addr-old',
        tier: 'profile',
        content: 'Current home shipping address is 101 Old Oak Lane, Austin, TX 78701.',
        tags: ['address', 'shipping'],
        importance: 0.9,
        ageDays: 60,
      },
    ],
    supersedingRecord: {
      fixtureId: 'addr-new',
      tier: 'profile',
      content: 'Current home shipping address is 742 Evergreen Terrace, Seattle, WA 98101.',
      tags: ['address', 'shipping'],
      importance: 0.95,
      ageDays: 0,
      supersedesFixtureId: 'addr-old',
    },
  },
  {
    kind: 'superseding',
    id: 'memory-supersede-endpoint',
    description: 'Return updated staging API endpoint and suppress deprecated v1 URL.',
    nowMs: BASE_NOW_MS,
    query: 'staging model manifest endpoint url',
    expectedLatestFixtureId: 'ep-v2',
    forbiddenStaleFixtureIds: ['ep-v1'],
    initialRecords: [
      {
        fixtureId: 'ep-v1',
        tier: 'document',
        content: 'Staging model manifest endpoint URL is https://v1-old.cdn.yours.sh/manifest.json.',
        tags: ['manifest', 'endpoint'],
        importance: 0.8,
        ageDays: 30,
      },
    ],
    supersedingRecord: {
      fixtureId: 'ep-v2',
      tier: 'document',
      content: 'Staging model manifest endpoint URL is https://v2-edge.cdn.yours.sh/manifest.json.',
      tags: ['manifest', 'endpoint'],
      importance: 0.9,
      ageDays: 0,
      supersedesFixtureId: 'ep-v1',
    },
  },
  {
    kind: 'temporal_decay',
    id: 'memory-decay-episodic-recency',
    description: 'Prefer recent episodic sprint status over stale 90-day-old sprint status.',
    nowMs: BASE_NOW_MS,
    query: 'weekly sprint release blocker status',
    expectedTopFixtureId: 'sp-recent',
    corpus: [
      {
        fixtureId: 'sp-old',
        tier: 'episodic',
        content: 'Weekly sprint release blocker status: waiting on Safari WebGPU flag.',
        tags: ['sprint', 'status'],
        importance: 0.65,
        ageDays: 95,
      },
      {
        fixtureId: 'sp-recent',
        tier: 'episodic',
        content: 'Weekly sprint release blocker status: all WGSL tests green, ready to tag v0.4.',
        tags: ['sprint', 'status'],
        importance: 0.65,
        ageDays: 1,
      },
    ],
  },
  {
    kind: 'temporal_decay',
    id: 'memory-decay-profile-stability',
    description: 'High-importance profile rule outranks older low-importance working scratchpad.',
    nowMs: BASE_NOW_MS,
    query: 'security compliance export format requirement',
    expectedTopFixtureId: 'sec-profile',
    corpus: [
      {
        fixtureId: 'sec-working',
        tier: 'working',
        content: 'Temporary scratchpad: export security compliance draft as plain CSV.',
        tags: ['security', 'export'],
        importance: 0.3,
        ageDays: 45,
      },
      {
        fixtureId: 'sec-profile',
        tier: 'profile',
        content: 'Security compliance requirement: always export encrypted AES-GCM bundles.',
        tags: ['security', 'export'],
        importance: 0.98,
        ageDays: 30,
      },
    ],
  },
  {
    kind: 'sensitive_domain',
    id: 'memory-sensitive-banking-auth',
    description: 'Reject persistence and recall of banking account and OAuth sign-in URLs.',
    probeQueries: ['bank checking account balance', 'google signin password', 'routing number'],
    candidateInputs: [
      {
        fixtureId: 'sens-bank',
        isSensitive: true,
        record: {
          tier: 'episodic',
          sourceUrl: 'https://online.chasebank.example.com/accounts/checking',
          content: 'Checking account balance $14,820.55 routing number 021000021.',
          importance: 0.8,
        },
      },
      {
        fixtureId: 'sens-auth',
        isSensitive: true,
        record: {
          tier: 'working',
          sourceUrl: 'https://accounts.google.com/v3/signin/challenge',
          content: 'User entered recovery password hint during sign-in.',
          importance: 0.7,
        },
      },
      {
        fixtureId: 'safe-docs',
        isSensitive: false,
        record: {
          tier: 'document',
          sourceUrl: 'https://yours.sh/docs/architecture',
          content: 'Local memory stores encrypted snapshots in IndexedDB with zero telemetry.',
          importance: 0.8,
        },
      },
    ],
  },
  {
    kind: 'sensitive_domain',
    id: 'memory-sensitive-token-url',
    description: 'Block URL query secrets, bearer tokens, and SSN patterns from entering memory.',
    probeQueries: ['bearer token', 'secret_live_9911', 'social security number'],
    candidateInputs: [
      {
        fixtureId: 'sens-token-url',
        isSensitive: true,
        record: {
          tier: 'episodic',
          sourceUrl: 'https://portal.example.org/oauth/callback?access_token=secret_live_9911',
          content: 'OAuth callback completed with token secret_live_9911.',
          importance: 0.6,
        },
      },
      {
        fixtureId: 'sens-ssn',
        isSensitive: true,
        record: {
          tier: 'profile',
          sourceUrl: 'https://hr.example.org/tax-forms',
          content: 'Employee SSN 123-45-6789 filed for W-2.',
          importance: 0.9,
        },
      },
      {
        fixtureId: 'safe-note',
        isSensitive: false,
        record: {
          tier: 'profile',
          sourceUrl: 'https://github.com/yours-research/yours-memory',
          content: 'Use 30-day half-life for episodic decay.',
          importance: 0.85,
        },
      },
    ],
  },
];
