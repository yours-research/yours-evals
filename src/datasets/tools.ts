import type { CanonicalToolName } from '../contracts.js';

export interface AomCompressionCase {
  kind: 'aom_compression';
  id: string;
  description: string;
  url: string;
  rawHtml: string;
  requiredSemantics: string[];
  minCompressionRatio: number;
}

export interface SchemaValidationSample {
  toolName: string;
  arguments: Record<string, unknown>;
  expectValid: boolean;
  expectedCanonicalName?: CanonicalToolName;
}

export interface SchemaValidationCase {
  kind: 'schema_validation';
  id: string;
  description: string;
  samples: SchemaValidationSample[];
}

export interface SandboxCase {
  kind: 'sandbox';
  id: string;
  description: string;
  code: string;
  expectBlocked: boolean;
  expectedOutput?: string | number;
}

export interface MultiHopTabFixture {
  tabId: number;
  title: string;
  url: string;
  text: string;
}

export interface MultiHopCase {
  kind: 'multi_hop';
  id: string;
  description: string;
  question: string;
  tabs: MultiHopTabFixture[];
  expectedFacts: string[];
}

export type ToolsEvalCase =
  | AomCompressionCase
  | SchemaValidationCase
  | SandboxCase
  | MultiHopCase;

export const TOOLS_DATASET: readonly ToolsEvalCase[] = [
  {
    kind: 'aom_compression',
    id: 'tools-aom-ecommerce',
    description: 'Distill noisy e-commerce HTML with scripts, tracking pixels, and CSS into semantic AOM.',
    url: 'https://shop.example.com/item/wgsl-dock',
    requiredSemantics: ['Pro Thunderbolt Dock', '$249.00', 'Add to Cart', 'In Stock'],
    minCompressionRatio: 3.0,
    rawHtml: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Pro Thunderbolt Dock</title>
      <style>.nav-wrap{display:flex;background:#111;color:#fff;padding:12px 24px}.promo-banner{font-size:12px}.btn-primary{background:#2563eb;border-radius:8px;padding:10px 18px}</style>
      <script>window.__ANALYTICS__={session:"abc1234567890",experiments:["exp_a","exp_b","exp_c"]};for(let i=0;i<10;i++){console.log("telemetry",i);}</script>
      </head><body>
      <header class="nav-wrap"><nav aria-label="Main Navigation"><a href="/">Home</a><a href="/deals">Deals</a><a href="/cart">Cart (2)</a></nav></header>
      <div class="ad-slot" data-tracking="pixel-998877"><img src="pixel.gif" alt="" width="1" height="1" /></div>
      <main id="product-main">
        <h1>Pro Thunderbolt Dock</h1>
        <p class="price" data-currency="USD">$249.00</p>
        <p class="availability">In Stock - Ships within 24 hours</p>
        <label for="qty">Quantity</label><input id="qty" type="number" value="1" min="1" max="10" />
        <button id="add-btn" class="btn-primary" type="button">Add to Cart</button>
      </main>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Pro Thunderbolt Dock","sku":"DOCK-4421","offers":{"price":"249.00"}}</script>
      <footer class="site-footer"><p>Copyright 2026 Example Shop Inc. All rights reserved. Cookie Preferences | Privacy Policy | Terms of Service</p></footer>
      </body></html>`,
  },
  {
    kind: 'aom_compression',
    id: 'tools-aom-dashboard',
    description: 'Distill SaaS telemetry dashboard with inline SVG noise into semantic metrics and controls.',
    url: 'https://console.example.com/gpu-nodes',
    requiredSemantics: ['Cluster Overview', 'Active Nodes: 14', 'GPU Utilization: 82%', 'Drain Node'],
    minCompressionRatio: 2.8,
    rawHtml: `<html><head><style>.card{border:1px solid #333;border-radius:12px;padding:16px;margin:8px}.grid{display:grid;grid-template-columns:repeat(3,1fr)}.sparkline path{stroke:#10b981;fill:none}</style></head>
      <body>
      <aside class="sidebar"><ul role="list"><li>Overview</li><li>Billing</li><li>Settings</li></ul></aside>
      <section class="main-panel">
        <h2>Cluster Overview</h2>
        <div class="grid">
          <div class="card"><span>Active Nodes: 14</span><svg class="sparkline" viewBox="0 0 100 20"><path d="M0 10 L10 8 L20 12 L30 5 L40 9 L50 3 L60 7 L70 4 L80 6 L90 2 L100 5"/></svg></div>
          <div class="card"><span>GPU Utilization: 82%</span><svg class="sparkline" viewBox="0 0 100 20"><path d="M0 15 L15 12 L30 10 L45 8 L60 6 L75 4 L90 3 L100 2"/></svg></div>
        </div>
        <form aria-label="Node Actions"><select aria-label="Target Region"><option value="us-east">us-east</option><option value="eu-west">eu-west</option></select><button type="submit">Drain Node</button></form>
      </section>
      <script>window.__INITIAL_STATE__={metrics:[12,14,18,22,45,67,82],nodes:["n1","n2","n3","n4"]};</script>
      </body></html>`,
  },
  {
    kind: 'aom_compression',
    id: 'tools-aom-article',
    description: 'Distill technical blog HTML stripping boilerplate cookie modals and analytics scripts.',
    url: 'https://blog.example.com/webgpu-subgroups',
    requiredSemantics: ['WebGPU Subgroup Matmul', '2.4x speedup', 'Download Benchmark CSV'],
    minCompressionRatio: 2.8,
    rawHtml: `<html><head><style>.cookie-wall{position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999}.article-body p{line-height:1.7;font-size:18px}</style>
      <script>function trackScroll(){navigator.sendBeacon('/log',JSON.stringify({y:window.scrollY,t:Date.now()}));}</script></head>
      <body>
      <div class="cookie-wall" role="dialog" aria-label="Cookie Banner"><p>We use cookies for analytics and personalization.</p><button>Accept All</button></div>
      <article class="article-body">
        <h1>WebGPU Subgroup Matmul</h1>
        <p>Enabling f16 subgroup matrix operations delivers a 2.4x speedup on consumer GPUs without external server calls.</p>
        <a href="/assets/bench.csv">Download Benchmark CSV</a>
      </article>
      <script>trackScroll();</script>
      </body></html>`,
  },
  {
    kind: 'schema_validation',
    id: 'tools-schema-canonical-valid',
    description: 'Validate canonical Schema v1.1 tool calls with required and optional arguments.',
    samples: [
      {
        toolName: 'read_active_tab',
        arguments: { includeLinks: true, maxTokens: 1500 },
        expectValid: true,
        expectedCanonicalName: 'read_active_tab',
      },
      {
        toolName: 'interact_page',
        arguments: { action: 'click', ref: 'btn-12' },
        expectValid: true,
        expectedCanonicalName: 'interact_page',
      },
      {
        toolName: 'memory_save',
        arguments: { tier: 'profile', content: 'User prefers dark mode.', importance: 0.9 },
        expectValid: true,
        expectedCanonicalName: 'memory_save',
      },
      {
        toolName: 'read_document',
        arguments: { uri: 'https://example.com/spec.pdf', pageRange: '1-5' },
        expectValid: true,
        expectedCanonicalName: 'read_document',
      },
    ],
  },
  {
    kind: 'schema_validation',
    id: 'tools-schema-legacy-aliases',
    description: 'Normalize legacy Pragma training aliases to Schema v1.1 canonical names.',
    samples: [
      {
        toolName: 'read_active_page',
        arguments: {},
        expectValid: true,
        expectedCanonicalName: 'read_active_tab',
      },
      {
        toolName: 'list_open_tabs',
        arguments: {},
        expectValid: true,
        expectedCanonicalName: 'list_tabs',
      },
      {
        toolName: 'web_search',
        arguments: { query: 'WebGPU subgroup support' },
        expectValid: true,
        expectedCanonicalName: 'search_web_tab',
      },
      {
        toolName: 'fetch_and_read_url',
        arguments: { url: 'https://yours.sh/docs' },
        expectValid: true,
        expectedCanonicalName: 'fetch_background_tab',
      },
      {
        toolName: 'js_calc',
        arguments: { code: '24 * 60' },
        expectValid: true,
        expectedCanonicalName: 'run_sandbox',
      },
    ],
  },
  {
    kind: 'schema_validation',
    id: 'tools-schema-invalid-args',
    description: 'Reject missing required fields, wrong field types, and disallowed extra properties.',
    samples: [
      {
        toolName: 'read_tab',
        arguments: {},
        expectValid: false,
      },
      {
        toolName: 'interact_page',
        arguments: { action: 'click', ref: 'btn-1', unexpectedFlag: true },
        expectValid: false,
      },
      {
        toolName: 'memory_recall',
        arguments: { query: 42 },
        expectValid: false,
      },
      {
        toolName: 'search_web_tab',
        arguments: { query: '' },
        expectValid: false,
      },
    ],
  },
  {
    kind: 'schema_validation',
    id: 'tools-schema-unknown-tools',
    description: 'Reject hallucinated tool names and mixed invalid alias calls.',
    samples: [
      {
        toolName: 'execute_shell_command',
        arguments: { cmd: 'rm -rf /' },
        expectValid: false,
      },
      {
        toolName: 'js_calc',
        arguments: { expression: '1+1' },
        expectValid: false,
      },
      {
        toolName: 'list_tabs',
        arguments: { windowId: 'main' },
        expectValid: true,
        expectedCanonicalName: 'list_tabs',
      },
    ],
  },
  {
    kind: 'sandbox',
    id: 'tools-sandbox-math',
    description: 'Compute deterministic financial compound interest inside isolated sandbox.',
    code: 'Math.round(1250 * Math.pow(1 + 0.045, 3) * 100) / 100',
    expectBlocked: false,
    expectedOutput: 1426.46,
  },
  {
    kind: 'sandbox',
    id: 'tools-sandbox-transform',
    description: 'Aggregate array metrics cleanly without side effects.',
    code: 'JSON.stringify([12, 18, 25, 45].filter(x => x >= 18).reduce((a, b) => a + b, 0))',
    expectBlocked: false,
    expectedOutput: '88',
  },
  {
    kind: 'sandbox',
    id: 'tools-sandbox-escape-block',
    description: 'Block Node/browser breakout primitives such as process, require, fetch, and constructor.',
    code: 'const fs = require("fs"); process.env.SECRET_KEY;',
    expectBlocked: true,
  },
  {
    kind: 'multi_hop',
    id: 'tools-multihop-invoice',
    description: 'Resolve order ID from active tab and look up tax and shipping total in open invoice tab.',
    question: 'What is the order ID, carrier, and grand total for the active shipment?',
    tabs: [
      {
        tabId: 101,
        title: 'Shipment Tracker',
        url: 'https://portal.example.com/shipments',
        text: 'Active shipment: Order ORD-78412 | Status: In Transit | Carrier: FastShip Express',
      },
      {
        tabId: 102,
        title: 'Invoices Q4',
        url: 'https://billing.example.com/invoices',
        text: 'ORD-78410 Total: $120.00\nORD-78412 Subtotal: $410.00 Tax: $32.80 Grand Total: $442.80\nORD-78415 Total: $89.00',
      },
    ],
    expectedFacts: ['ORD-78412', 'FastShip Express', '$442.80'],
  },
  {
    kind: 'multi_hop',
    id: 'tools-multihop-config',
    description: 'Correlate service port from architecture tab with rate-limit policy from security tab.',
    question: 'Which port and rate limit apply to the local inference gateway?',
    tabs: [
      {
        tabId: 201,
        title: 'Service Registry',
        url: 'https://intranet.example.com/services',
        text: 'Service: local-inference-gateway | Endpoint: 127.0.0.1:8443 | Tier: tier1-f16-subgroups',
      },
      {
        tabId: 202,
        title: 'Gateway Policy',
        url: 'https://intranet.example.com/security',
        text: 'Policy for local-inference-gateway: max_rpm=120, require_origin_allowlist=true',
      },
    ],
    expectedFacts: ['8443', '120', 'tier1-f16-subgroups'],
  },
];
