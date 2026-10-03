import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as s from '../../db/schema.js';
import { uid } from '../../db/seed.js';
import { createEnv } from '../contract/test-env.js';

let env: Awaited<ReturnType<typeof createEnv>>;
beforeAll(async () => {
  env = await createEnv();
}, 120_000);
const TENDER = uid('tender:itmsp');

describe('tender pack export to PDF and Word (US-TND-05)', () => {
  it('is a real PDF with the pack sections, status, version and a footer on every page', async () => {
    const r = await env.call('procurement', 'GET', `/tenders/${TENDER}/pack/pdf`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toMatch(
      /attachment; filename="tender-pack-PR-2026-\d{4}-v\d+\.pdf"/,
    );
    const txt = r.rawPayload.toString('latin1');
    expect(txt.startsWith('%PDF-')).toBe(true);
    expect(txt).toContain('Tender pack:');
    expect(txt).toContain('Scope of work');
    expect(txt).toMatch(/Tender pack PR-2026-\d{4} - exported 2026-10-02/);
    expect(txt).toMatch(/version \d+/);
  });
  it('is a real Word document with the same content', async () => {
    const r = await env.call('procurement', 'GET', `/tenders/${TENDER}/pack/docx`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const txt = r.rawPayload.toString('utf8');
    expect(txt).toContain('Scope of work');
    expect(txt).toContain('Conditions of tendering');
    expect(r.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
  });
  it('is for those who run or oversee the tender, is audited, and 404s an unknown tender', async () => {
    for (const who of ['procurement', 'delegate', 'legal', 'probity', 'exec'])
      expect((await env.call(who, 'GET', `/tenders/${TENDER}/pack/pdf`)).statusCode, who).toBe(200);
    for (const who of ['requester', 'evaluator-tech', 'finance', 'supplier', 'admin'])
      expect((await env.call(who, 'GET', `/tenders/${TENDER}/pack/docx`)).statusCode, who).toBe(403);
    expect(
      (await env.call('procurement', 'GET', '/tenders/00000000-0000-4000-8000-000000000000/pack/pdf'))
        .statusCode,
    ).toBe(404);
    const rows = await env.withSystem(env.database, (tx) =>
      tx
        .select()
        .from(s.auditEvent)
        .where(and(eq(s.auditEvent.entityId, TENDER), eq(s.auditEvent.action, 'tender_pack.export'))),
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.map((e) => (e.after as { format: string }).format)).toEqual(
      expect.arrayContaining(['PDF', 'DOCX']),
    );
  });
});
