import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { createEnv, type Json } from '../contract/test-env.js';
import { MODELS, type AiModel } from '../b10ai/models.js';
import { resolveModel } from '../b10ai/service.js';
import { TENANT_ID } from '../../db/seed.js';

/**
 * SEC-D05: no data to public AI endpoints. The behavioural tests are in residency.test.ts (probe, connector, allow-list
 * changes). This file holds the two that guard the future: a model whose host is not on the list is refused, and a
 * static scan that fails on any network call outside the egress module.
 */

/** Files allowed to contain network-call syntax, each with the reason. Anything else fails the scan. */
export const EGRESS_SCAN_ALLOWLIST: Record<string, string> = {
  'modules/b11priv/egress.ts':
    'the egress policy itself; it mentions the names in its documentation and makes no call',
};

/** Patterns that mean "this code can reach beyond the process". */
export const NETWORK_PATTERNS: Array<[string, RegExp]> = [
  ['fetch(', /(^|[^\w.$])fetch\s*\(/],
  ['http(s).request / get', /\bhttps?\.(request|get)\s*\(/],
  [
    'node:http / https / http2 / net / tls / dgram / dns import',
    /from\s+['"](?:node:)?(?:https?|http2|net|tls|dgram|dns)['"]/,
  ],
  ['require of a network module', /require\(\s*['"](?:node:)?(?:https?|http2|net|tls|dgram|dns)['"]\s*\)/],
  ['net.connect / createConnection', /\bnet\.(connect|createConnection)\s*\(/],
  [
    'undici / axios / node-fetch / got / superagent',
    /from\s+['"](?:undici|axios|node-fetch|got|superagent|cross-fetch)['"]/,
  ],
  ['XMLHttpRequest / WebSocket client', /\b(?:XMLHttpRequest|new\s+WebSocket)\b/],
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Strips comments so a mention in documentation does not count; returns the lines that still match. */
export function networkUses(text: string): Array<{ line: number; what: string }> {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const hits: Array<{ line: number; what: string }> = [];
  code.split('\n').forEach((l, i) => {
    for (const [what, re] of NETWORK_PATTERNS) if (re.test(l)) hits.push({ line: i + 1, what });
  });
  return hits;
}

describe('SEC-D05 static scan: a future developer cannot add a network call silently', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url)); // apps/api/src

  it('the scanner recognises each kind of call (so a pass means something)', () => {
    const samples = [
      "const r = await fetch('https://api.openai.com/v1/chat');",
      "import http from 'node:http';",
      "import https from 'https';",
      "https.request({ host: 'x' }, cb);",
      "import net from 'node:net';",
      "const s = net.connect(80, 'x');",
      "import axios from 'axios';",
      "const w = new WebSocket('wss://x');",
    ];
    for (const sample of samples) expect(networkUses(sample).length, sample).toBeGreaterThan(0);
    expect(
      networkUses("// fetch('https://x') is not allowed here\n/* http.request(x) */\nconst a = 1;"),
    ).toEqual([]);
    expect(networkUses("app.inject({ url: '/x' }); const x = await database.fetchAll();")).toEqual([]);
  });

  it('finds no network call in apps/api/src outside the documented allow-list', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of sourceFiles(root)) {
      const rel = relative(root, file).split(sep).join('/');
      scanned += 1;
      if (rel in EGRESS_SCAN_ALLOWLIST) continue;
      for (const h of networkUses(readFileSync(file, 'utf8')))
        offenders.push(`${rel}:${h.line} uses ${h.what}`);
    }
    expect(scanned).toBeGreaterThan(100);
    expect(
      offenders,
      `Every outbound call must go through modules/b11priv/egress.ts:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('every allow-listed file exists and says why', () => {
    for (const [file, why] of Object.entries(EGRESS_SCAN_ALLOWLIST)) {
      expect(statSync(join(root, file)).isFile(), file).toBe(true);
      expect(why.length).toBeGreaterThan(10);
    }
  });
});

describe('SEC-D05 a model whose endpoint host is not on the allow-list is refused and audited', () => {
  let env: Awaited<ReturnType<typeof createEnv>>;
  const call = (...a: Parameters<typeof env.call>) => env.call(...a);
  const publicModel: AiModel = {
    id: 'public-llm-v1',
    provider: 'Public LLM (a test model on a public host)',
    label: 'Public LLM (test)',
    simulated: true,
    builtIn: false,
    endpointHost: 'api.public-llm.example',
    dataHandling: {
      processedIn: 'In the elected country',
      retention: 'None',
      retained: false,
      usedForTraining: false,
      inCountry: true,
      region: 'AU',
    },
    async complete() {
      return { text: 'never called in this test' };
    },
  };
  beforeAll(async () => {
    env = await createEnv();
    (MODELS as AiModel[]).push(publicModel);
  }, 120_000);
  afterAll(() => {
    const i = (MODELS as AiModel[]).indexOf(publicModel);
    if (i >= 0) (MODELS as AiModel[]).splice(i, 1);
  });

  it('cannot be switched on, though it is approved and in region', async () => {
    const q = await call('admin', 'POST', `/ai/models/${publicModel.id}/request-approval`, {
      reason: 'Egress test',
    });
    expect(q.statusCode, q.body).toBe(201);
    const dec = await call('probity', 'POST', `/ai/approvals/${q.json().id}/decision`, {
      decision: 'APPROVE',
      reason: 'Approved so that only the egress rule can stop it',
    });
    expect(dec.statusCode, dec.body).toBe(200);
    const r = await call('admin', 'PUT', '/ai/active-model', { activeModel: publicModel.id });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('EGRESS_BLOCKED');
    expect(r.json().title).toMatch(/api\.public-llm\.example/);
    const ev = await env.withSystem(env.database, (tx) =>
      tx.select().from(s.auditEvent).where(eq(s.auditEvent.action, 'egress.blocked')),
    );
    expect((ev as Json[]).at(-1)).toMatchObject({
      result: 'DENIED',
      after: { target: 'api.public-llm.example' },
    });
    const page = ((await call('probity', 'GET', '/admin/egress')).json() as Json).recent;
    expect(page[0]).toMatchObject({ kind: 'EGRESS', target: 'api.public-llm.example' });
    expect(((await call('admin', 'GET', '/ai/active-model')).json() as Json).activeModel).toBe(
      'rules-simulated-v1',
    );
  });

  it('is never used even if some path had left its name in the setting: the built-in model answers instead', async () => {
    await env.withSystem(env.database, async (tx) => {
      await tx
        .update(s.tenant)
        .set({ config: { settings: { ai: { activeModel: publicModel.id } } } })
        .where(eq(s.tenant.id, TENANT_ID));
      const r = await resolveModel(tx, TENANT_ID);
      expect(r.model.id).toBe('rules-simulated-v1');
      expect(r.source).toBe('FALLBACK');
      expect(r.refused).toBe('EGRESS_BLOCKED');
    });
    const chat = await call('requester', 'POST', '/assistant/chat', {
      message: 'How does the workflow work?',
    });
    expect(chat.json()).toMatchObject({
      model: 'rules-simulated-v1',
      modelSource: 'FALLBACK',
      modelRefused: 'EGRESS_BLOCKED',
    });
  });
});
