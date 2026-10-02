import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManualClock } from '@if/shared';
import { describe, expect, it } from 'vitest';
import { checkUpload, MAX_FILE_BYTES, scanBytes, SealedStore } from './files.js';
import { buildTenderPack } from './pack.js';
import { effectiveStatus, isOpenForBids, makeReceipt, validAbn, validateWindow } from './rules.js';
import { TENDER_FIELDS, TENDER_TYPES } from './fields.js';

const pdf = Buffer.from('%PDF-1.7\nhello');
const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

describe('statutory publication window (US-TND-04)', () => {
  const t0 = new Date('2026-10-02T09:00:00Z');
  const plus = (days: number, extraMs = 0) => new Date(t0.getTime() + days * 86_400_000 + extraMs);
  it('10 days is refused when 25 are required, with the actual and required days', () => {
    expect(validateWindow(t0, plus(10), 25)).toEqual({ ok: false, days: 10, minDays: 25 });
  });
  it('exactly 25 days is accepted; 24 days 23 hours is not', () => {
    expect(validateWindow(t0, plus(25), 25).ok).toBe(true);
    expect(validateWindow(t0, plus(25, -3_600_000), 25).ok).toBe(false);
  });
  it('a closing time before publication is never valid, even with no minimum', () => {
    expect(validateWindow(t0, plus(-1), 0).ok).toBe(false);
  });
});

describe('close-time lock with a fake clock (US-SUP-04)', () => {
  const closes = new Date('2026-11-01T05:00:00Z');
  it('is open one millisecond before close and closed at the exact close time', () => {
    const clock = new ManualClock('2026-11-01T04:59:59.999Z');
    expect(isOpenForBids('PUBLISHED', closes, clock.now())).toBe(true);
    clock.set('2026-11-01T05:00:00.000Z');
    expect(isOpenForBids('PUBLISHED', closes, clock.now())).toBe(false);
    expect(effectiveStatus('PUBLISHED', closes, clock.now())).toBe('CLOSED');
  });
  it('a staged tender is never open for bids, and later states are unchanged', () => {
    const now = new Date('2026-10-02T00:00:00Z');
    expect(isOpenForBids('STAGED', closes, now)).toBe(false);
    expect(effectiveStatus('EVALUATING', closes, new Date('2027-01-01'))).toBe('EVALUATING');
  });
});

describe('ABN checksum and receipts', () => {
  it('accepts the published ATO example ABN with or without spaces and rejects bad ones', () => {
    expect(validAbn('51 824 753 556')).toBe(true);
    expect(validAbn('51824753556')).toBe(true);
    expect(validAbn('51824753557')).toBe(false);
    expect(validAbn('1234')).toBe(false);
    expect(validAbn('abcdefghijk')).toBe(false);
  });
  it('receipt carries the ABN tail and date and changes with the time', () => {
    const a = makeReceipt('51 824 753 556', new Date('2026-10-02T01:02:03Z'), 'sub-1');
    expect(a).toMatch(/^RC-3556-20261002-[0-9A-F]{8}$/);
    expect(makeReceipt('51 824 753 556', new Date('2026-10-02T01:02:04Z'), 'sub-1')).not.toBe(a);
  });
});

describe('upload checks (US-SUP-03 AC2)', () => {
  it('accepts a real PDF and a real zip-based office file', () => {
    expect(checkUpload('Technical response.pdf', pdf)).toMatchObject({
      ok: true,
      contentType: 'application/pdf',
    });
    expect(checkUpload('pricing.xlsx', zipBytes)).toMatchObject({ ok: true });
  });
  it('refuses a type outside the allow-list and says which are allowed', () => {
    const r = checkUpload('bid.exe', Buffer.from('MZ'));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe('FILE_NAME_INVALID');
    const r2 = checkUpload('bid.rtf', Buffer.from('{\\rtf1}'));
    expect(!r2.ok && r2.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(!r2.ok && r2.message).toMatch(/pdf/);
  });
  it('refuses double extensions in either order and path tricks', () => {
    for (const n of ['bid.pdf.exe', 'bid.exe.pdf', 'bid.js.pdf', 'x.html.zip']) {
      const r = checkUpload(n, pdf);
      expect(r.ok, n).toBe(false);
    }
    expect(checkUpload('../../etc/passwd.pdf', pdf)).toMatchObject({ ok: true, safeName: 'passwd.pdf' });
    expect(checkUpload('.hidden.pdf', pdf).ok).toBe(false);
    expect(checkUpload('a\u0000.pdf', pdf).ok).toBe(false);
  });
  it('refuses a file whose contents do not match its extension', () => {
    const r = checkUpload('report.pdf', Buffer.from('this is not a pdf'));
    expect(!r.ok && r.code).toBe('FILE_CONTENT_MISMATCH');
    expect(checkUpload('notes.txt', Buffer.from([0, 1, 2, 3])).ok).toBe(false);
  });
  it('refuses empty and over-size files', () => {
    expect(checkUpload('a.pdf', Buffer.alloc(0)).ok).toBe(false);
    const big = Buffer.concat([pdf, Buffer.alloc(MAX_FILE_BYTES)]);
    const r = checkUpload('a.pdf', big);
    expect(!r.ok && r.code).toBe('FILE_TOO_LARGE');
  });
  it('scan stub flags only the EICAR test string', () => {
    expect(scanBytes(Buffer.from('X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'))).toBe('INFECTED');
    expect(scanBytes(pdf)).toBe('CLEAN');
  });
});

describe('sealed store', () => {
  it('round-trips, stores ciphertext (not the plaintext) and refuses a key outside the folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'if-store-'));
    const store = new SealedStore(dir, 'unit-test-secret-unit-test-secret-1234');
    await store.put('t1/s1/f1', pdf);
    expect((await store.get('t1/s1/f1')).equals(pdf)).toBe(true);
    const raw = await readFile(join(dir, 't1', 's1', 'f1'));
    expect(raw.includes('%PDF')).toBe(false);
    await expect(store.put('../escape', pdf)).rejects.toThrow(/escapes/);
    await store.remove('t1/s1/f1');
    expect(await readdir(join(dir, 't1', 's1'))).toEqual([]);
    const other = new SealedStore(dir, 'a-different-secret-a-different-secret-99');
    await store.put('t1/s1/f2', pdf);
    await expect(other.get('t1/s1/f2')).rejects.toThrow();
  });
});

describe('tender pack generator (US-TND-01)', () => {
  const base = {
    title: 'Facilities cleaning services',
    organisation: 'Meridian Group',
    category: 'Building cleaning',
    termMonths: '36',
    businessUnit: 'Facilities',
    plan: {
      background: 'Existing arrangements are ending.',
      requirements: 'Clean all sites nightly.',
      deliverables: 'Nightly service.',
      milestones: 'Tender closes 13 November.',
    },
    request: {},
    contactEmail: 'procurement@meridian.example',
  };
  it('fills every section for every procurement type', () => {
    for (const type of TENDER_TYPES) {
      const pack = buildTenderPack({ ...base, type });
      for (const f of TENDER_FIELDS) expect(pack[f.key], `${type}.${f.key}`).toBeTruthy();
    }
  });
  it('pulls requirements and deliverables from the plan and never writes the budget or other internal wording', () => {
    const pack = buildTenderPack({
      ...base,
      type: 'RFT',
      request: { estimatedValue: '1200000' },
      plan: {
        ...base.plan,
        background:
          'Existing arrangements are ending.\n\nThe estimated value is AUD 1,200,000 over 36 months.\n\nComplexity has been assessed as high, which determines the governance steps.',
        milestones:
          'Plan approved: 9 October 2026\n\nTender closes: 13 November 2026\n\nEvaluation complete and report approved: 4 December 2026',
      },
    });
    expect(pack.overview).toContain('Existing arrangements are ending.');
    expect(pack.timetable).toContain('Tender closes: 13 November 2026');
    expect(pack.timetable).not.toMatch(/approved/i);
    expect(pack.requirements).toContain('Clean all sites nightly.');
    expect(pack.deliverables).toContain('Nightly service.');
    expect(JSON.stringify(pack)).not.toMatch(/1[, ]?200[, ]?000|estimated|complexity|governance|AUD/i);
  });
  it('weights add to 100 for tender and proposal; information requests are not scored for award', () => {
    for (const type of ['RFT', 'RFP'] as const) {
      const text = buildTenderPack({ ...base, type }).evaluationCriteria!;
      const total = [...text.matchAll(/: (\d+)%/g)].reduce((s, m) => s + Number(m[1]), 0);
      expect(total).toBe(100);
    }
    expect(buildTenderPack({ ...base, type: 'RFI' }).evaluationCriteria).toMatch(/not scored|no contract/);
    expect(buildTenderPack({ ...base, type: 'RFI' }).evaluationCriteria).not.toMatch(/\d+%/);
  });
  it('is deterministic', () => {
    expect(buildTenderPack({ ...base, type: 'RFP' })).toEqual(buildTenderPack({ ...base, type: 'RFP' }));
  });
});
