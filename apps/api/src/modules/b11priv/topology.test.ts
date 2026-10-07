import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createEnv, type Json } from '../contract/test-env.js';
import { TOPOLOGY, TOPOLOGY_LABEL } from './topology.js';

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url));

describe('SEC-D11 hosting topology choice: design only, clearly labelled, not built', () => {
  let env: Awaited<ReturnType<typeof createEnv>>;
  beforeAll(async () => {
    env = await createEnv();
  }, 120_000);

  it('serves the three options, each with flows, responsibilities, residency and key management, labelled design only', async () => {
    const r = await env.call('requester', 'GET', '/design/hosting-topology');
    expect(r.statusCode, r.body).toBe(200);
    const v = r.json() as Json;
    expect(v).toMatchObject({ label: 'DESIGN ONLY: not built', designOnly: true });
    expect(v.options.map((o: Json) => o.id)).toEqual(['PLATFORM_SAAS', 'CUSTOMER_CLOUD', 'HYBRID']);
    for (const o of v.options) {
      expect(o.flows.length, o.id).toBeGreaterThanOrEqual(3);
      expect(o.platformResponsible.length, o.id).toBeGreaterThan(0);
      expect(o.customerResponsible.length, o.id).toBeGreaterThan(0);
      expect(o.residency.length, o.id).toBeGreaterThan(20);
      expect(o.keyManagement.length, o.id).toBeGreaterThan(20);
    }
    expect(v.note).toMatch(/not built/);
    expect((await env.call('supplier', 'GET', '/design/hosting-topology')).statusCode).toBe(403);
  });

  it('the page draws each option as an inline SVG with a title, a description and a text alternative, and says design only', () => {
    const page = readFileSync(repo('apps/web/src/app/app/hosting-topology/page.tsx'), 'utf8');
    expect(page).toMatch(/DESIGN ONLY: not built/);
    const panel = readFileSync(repo('apps/web/src/components/b11/topology.tsx'), 'utf8');
    expect(panel).toMatch(/<svg/);
    expect(panel).toMatch(/role="img"/);
    expect(panel).toMatch(/aria-labelledby/);
    expect(panel).toMatch(/<title/);
    expect(panel).toMatch(/<desc/);
    expect(panel).toMatch(/text alternative of the diagram/);
    for (const o of TOPOLOGY) expect(panel, o.id).toContain(`'${o.id}'`);
    expect(TOPOLOGY_LABEL).toBe('DESIGN ONLY: not built');
  });

  it('the design document exists, covers all three options and is labelled design only', () => {
    const doc = readFileSync(repo('docs/design/hosting-topology.md'), 'utf8');
    expect(doc).toMatch(/\*\*DESIGN ONLY: not built\.\*\*/);
    for (const name of ['Platform-hosted SaaS', 'Customer cloud', 'Hybrid']) expect(doc).toContain(name);
    for (const word of ['Residency', 'Key management', 'responsible for']) expect(doc).toContain(word);
    expect(doc).toContain('SEC-D11');
  });
});
