import { describe, expect, it } from 'vitest';
import { DEFAULT_LIBRARY } from './clauselib.js';
import { OcrUnavailable, SimulatedOcrEngine, parseFixture, recogniseDocument, sniff } from './engine.js';
import { analyse, coerceCorrection, applyCorrection, reassess } from './pipeline.js';
import { buildReport, type ReportItem } from './report.js';
import {
  buildSample,
  pdfFromLines,
  placeholderJpg,
  placeholderPng,
  placeholderTiff,
  SAMPLE_KEYS,
} from './samples.js';
import { isValidAbn, parseDateText } from './text.js';
import { ArchiveError, readZip, safeEntryPath } from './zip.js';
import { zip } from './test-kit.js';
import { embedFixture } from './engine.js';

const TODAY = '2026-10-02';
async function read(key: string) {
  const s = buildSample(key)!;
  const r = await recogniseDocument({ name: s.fileName, bytes: s.bytes, kind: sniff(s.bytes) as 'PDF' });
  return { s, r, a: analyse(r.pages, DEFAULT_LIBRARY, 0.8, TODAY) };
}
const f = (a: Awaited<ReturnType<typeof read>>['a'], k: string) => a.fields.find((x) => x.key === k)!;

describe('CP-07 engines: real PDF text layer and SIMULATED recognition', () => {
  it('CP-07 reads the text layer of a PDF for real, page by page, and the page text holds the source span', async () => {
    const { r, a } = await read('services-agreement');
    expect(r.simulated).toBe(false);
    expect(r.scanned).toBe(false);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]!.confidence).toBe(0.99);
    const end = f(a, 'endDate').source!;
    expect(r.pages[end.page - 1]!.text.slice(end.start, end.end)).toBe('30 June 2028');
    // clause 9 is on page 2
    expect(f(a, 'dataLocation').source!.page).toBe(2);
  });

  it('CP-07 sends images and scanned PDFs to the SIMULATED engine, labelled, with the fixture page confidence', async () => {
    const png = await read('scanned-security');
    expect(sniff(png.s.bytes)).toBe('PNG');
    expect(png.r).toMatchObject({ simulated: true, engine: 'simulated-ocr-v1 (SIMULATED)' });
    expect(png.r.pages[0]!.confidence).toBe(0.72);
    const pdf = await read('scanned-it-support');
    expect(pdf.r).toMatchObject({ simulated: true, scanned: true });
    expect(pdf.r.warnings.join(' ')).toContain('no text layer');
  });

  it('CP-07 reads JPG and TIFF containers and a sidecar fixture; a file with no fixture is refused with a clear message', async () => {
    const text =
      'LICENCE TEST AGREEMENT\nThe agreement commences on 1 March 2026 and ends on 28 February 2027. '.repeat(
        1,
      );
    const fx = { simulated: true as const, pages: [{ text, confidence: 0.9 }] };
    for (const [bytes, kind] of [
      [placeholderJpg(), 'JPG'],
      [placeholderTiff(), 'TIFF'],
      [placeholderPng(), 'PNG'],
    ] as const) {
      expect(sniff(bytes)).toBe(kind);
      const emb = await recogniseDocument({ name: 'x', bytes: embedFixture(bytes, fx), kind });
      expect(emb.pages[0]!.text).toContain('ends on 28 February 2027');
      const side = await recogniseDocument({
        name: 'x',
        bytes,
        kind,
        sidecar: Buffer.from(JSON.stringify(fx)),
      });
      expect(side.pages[0]!.confidence).toBe(0.9);
      await expect(recogniseDocument({ name: 'x', bytes, kind })).rejects.toBeInstanceOf(OcrUnavailable);
    }
    expect(parseFixture('{"pages":[{"text":"a","confidence":2}]}')).toBeNull();
    expect(
      await new SimulatedOcrEngine().recognise({
        name: 'a',
        bytes: embedFixture(placeholderPng(), fx),
        kind: 'PNG',
      }),
    ).toMatchObject({ simulated: true });
  });

  it('CP-07 sniffs by content, not by name', () => {
    expect(sniff(Buffer.from('MZ not a document at all'))).toBeNull();
    expect(sniff(pdfFromLines(['A AGREEMENT', 'x']))).toBe('PDF');
  });
});

describe('CP-07 extraction accuracy over the synthetic samples (exact values)', () => {
  it('CP-07 services agreement: every field exact, READY, nothing to review', async () => {
    const { a } = await read('services-agreement');
    const v = Object.fromEntries(a.fields.map((x) => [x.key, x.value]));
    expect(v).toEqual({
      title: 'Facilities Management Services Agreement',
      contractNumber: 'FMS-2025-0031',
      customer: 'Meridian Group (demo)',
      supplier: 'Brightwave Cleaning Pty Ltd',
      supplierAbn: '51824753556',
      effectiveDate: '2025-07-01',
      endDate: '2028-06-30',
      termMonths: 36,
      renewal: { kind: 'OPTION', count: 2, months: 12, extensionsMonths: [12, 12] },
      noticeDays: 90,
      value: { amount: 1250000, currency: 'AUD' },
      paymentTerms: 30,
      governingLaw: 'New South Wales',
      liabilityCap: { basis: 'FIXED', amount: 2500000, currency: 'AUD' },
      indemnity: { present: true, party: 'SUPPLIER' },
      terminationConvenience: { present: true, party: 'CUSTOMER', noticeDays: 60 },
      serviceLevels: [
        'The Supplier will meet a service availability of 99.5% each month and will respond to priority 1 incidents within 2 hours.',
      ],
      confidentiality: { present: true },
      dataLocation: { location: 'Australia', inAustralia: true },
      insurance: [
        { cover: 'Public liability', amount: 10000000, currency: 'AUD' },
        { cover: 'Professional indemnity', amount: 5000000, currency: 'AUD' },
      ],
    });
    expect(a.status).toBe('READY');
    expect(a.fields.every((x) => x.source && x.source.text.length > 0)).toBe(true);
  });

  it('CP-07 SaaS subscription: USD value, derived end date (needs review), auto renewal, offshore data', async () => {
    const { a } = await read('saas-subscription');
    expect(f(a, 'value').value).toEqual({ amount: 180000, currency: 'USD' });
    expect(f(a, 'effectiveDate').value).toBe('2026-03-15');
    expect(f(a, 'endDate')).toMatchObject({ value: '2029-03-14', method: 'DERIVED', needsReview: true });
    expect(f(a, 'termMonths').value).toBe(36);
    expect(f(a, 'renewal').value).toMatchObject({ kind: 'AUTO_RENEWAL', months: 12 });
    expect(f(a, 'noticeDays').value).toBe(60);
    expect(f(a, 'paymentTerms').value).toBe(45);
    expect(f(a, 'governingLaw').value).toBe('Victoria');
    expect(f(a, 'liabilityCap').value).toMatchObject({ basis: 'FEES_12_MONTHS', months: 12 });
    expect(f(a, 'dataLocation').value).toEqual({ location: 'United States', inAustralia: false });
    for (const k of ['indemnity', 'terminationConvenience', 'insurance'])
      expect(f(a, k).status).toBe('NOT_FOUND');
    expect(a.status).toBe('NEEDS_REVIEW');
  });

  it('CP-07 office licence: value derived from the annual fee, option to renew, supplier-only convenience termination', async () => {
    const { a } = await read('office-licence');
    expect(f(a, 'title').value).toBe('Licence to Occupy Office Premises');
    expect(f(a, 'supplier').value).toBe('Harbourside Property Holdings Pty Ltd');
    expect(f(a, 'customer').value).toBe('Meridian Group (demo)');
    expect(f(a, 'value')).toMatchObject({
      value: { amount: 510000, currency: 'AUD' },
      method: 'DERIVED',
      needsReview: true,
    });
    expect(f(a, 'termMonths').value).toBe(60);
    expect(f(a, 'renewal').value).toMatchObject({ kind: 'OPTION', count: 1, months: 60 });
    expect(f(a, 'noticeDays').value).toBe(180);
    expect(f(a, 'paymentTerms').value).toBe(14);
    expect(f(a, 'terminationConvenience').value).toEqual({
      present: true,
      party: 'SUPPLIER',
      noticeDays: 180,
    });
    expect(f(a, 'indemnity').value).toEqual({ present: true, party: 'CUSTOMER' });
    expect(f(a, 'insurance').value).toEqual([
      { cover: 'Public liability', amount: 20000000, currency: 'AUD' },
    ]);
    expect(f(a, 'governingLaw').value).toBe('Queensland');
  });

  it('CP-07 scanned samples: confidence follows the page, a garbled date is not guessed', async () => {
    const sec = await read('scanned-security');
    expect(f(sec.a, 'effectiveDate')).toMatchObject({
      value: '2026-03-01',
      confidence: 0.684,
      pageConfidence: 0.72,
      needsReview: true,
    });
    expect(f(sec.a, 'endDate')).toMatchObject({ status: 'NOT_FOUND', needsReview: true });
    expect(f(sec.a, 'value').value).toEqual({ amount: 96000, currency: 'AUD' });
    expect(sec.a.status).toBe('NEEDS_REVIEW');
    const it = await read('scanned-it-support');
    expect(f(it.a, 'title').value).toBe('IT Support Services Agreement');
    expect(f(it.a, 'endDate').value).toBe('2027-01-31');
    expect(f(it.a, 'liabilityCap').value).toEqual({ basis: 'FIXED', amount: 480000, currency: 'AUD' });
    expect(it.a.status).toBe('READY');
  });

  it('CP-07 helpers: dates, ABN check', () => {
    expect(parseDateText('1st July 2025')).toBe('2025-07-01');
    expect(parseDateText('31/02/2025')).toBeNull();
    expect(parseDateText('March 5, 2026')).toBe('2026-03-05');
    expect(isValidAbn('51 824 753 556')).toBe(true);
    expect(isValidAbn('12005357522')).toBe(false);
  });
});

describe('CP-07 clause detection against the library, missing mandatory clauses and deviations', () => {
  const clause = (a: Awaited<ReturnType<typeof read>>['a'], k: string) => a.clauses.find((c) => c.key === k)!;
  it('CP-07 the complete agreement has every mandatory clause and no missing-mandatory finding', async () => {
    const { a } = await read('services-agreement');
    expect(a.clauses.filter((c) => c.mandatory && !c.found)).toEqual([]);
    expect(a.findings.filter((x) => x.code === 'MISSING_MANDATORY_CLAUSE')).toEqual([]);
    expect(clause(a, 'PAYMENT')).toMatchObject({ found: true, match: 'STANDARD', similarity: 1 });
    expect(clause(a, 'INDEMNITY').source!.text).toContain('indemnifies the Customer');
    expect(clause(a, 'LIABILITY').text).not.toContain('indemnifies');
  });

  it('CP-07 the SaaS agreement is missing indemnity, insurance and convenience termination, and deviates on data and liability', async () => {
    const { a } = await read('saas-subscription');
    const missing = a.findings.filter((x) => x.code === 'MISSING_MANDATORY_CLAUSE').map((x) => x.clauseKey);
    expect(missing.sort()).toEqual(['INDEMNITY', 'INSURANCE', 'TERMINATION_CONVENIENCE']);
    const codes = a.findings.map((x) => x.code);
    expect(codes).toEqual(
      expect.arrayContaining(['DATA_OFFSHORE', 'LIABILITY_CAP_LOW', 'AUTO_RENEWAL', 'PAYMENT_TERMS_LONG']),
    );
    expect(a.findings.find((x) => x.code === 'DATA_OFFSHORE')!.severity).toBe('HIGH');
  });

  it('CP-07 the licence is missing confidentiality and liability, and only the licensor may terminate for convenience', async () => {
    const { a } = await read('office-licence');
    expect(
      a.findings
        .filter((x) => x.code === 'MISSING_MANDATORY_CLAUSE')
        .map((x) => x.clauseKey)
        .sort(),
    ).toEqual(['CONFIDENTIALITY', 'LIABILITY']);
    expect(a.findings.map((x) => x.code)).toContain('TFC_SUPPLIER_ONLY');
  });

  it('CP-07 wording far from the standard is flagged as a deviation with its similarity', () => {
    const pages = [
      {
        page: 1,
        confidence: 0.99,
        text: 'TEST AGREEMENT\n\n1. Payment\nInvoices are settled by cheque at the end of the season.',
      },
    ];
    const a = analyse(pages, DEFAULT_LIBRARY, 0.8, TODAY);
    const pay = a.clauses.find((c) => c.key === 'PAYMENT')!;
    expect(pay.found).toBe(true);
    expect(pay.match).toBe('MATERIAL_DEVIATION');
    expect(a.findings.some((x) => x.code === 'CLAUSE_DEVIATION' && x.clauseKey === 'PAYMENT')).toBe(true);
  });
});

describe('CP-07 review rules', () => {
  it('CP-07 a correction is validated, stored whole and clears the review need; findings are recomputed', async () => {
    const { a } = await read('scanned-security');
    const end = f(a, 'endDate');
    expect(() => coerceCorrection('endDate', 'not a date', end)).toThrow();
    expect(() => coerceCorrection('value', null, f(a, 'value'))).toThrow();
    const fixed = applyCorrection(end, coerceCorrection('endDate', '28 February 2027', end), 'smudged');
    expect(fixed).toMatchObject({ value: '2027-02-28', confidence: 1, status: 'CORRECTED', reviewed: true });
    const fields = a.fields.map((x) => (x.key === 'endDate' ? fixed : { ...x, reviewed: true }));
    expect(reassess(fields, a.clauses, 0.8, TODAY).status).toBe('READY');
  });
});

describe('CP-07 zip safety', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof ArchiveError ? e.code : 'OTHER';
    }
    return 'NONE';
  };

  it('CP-07 reads stored and deflated entries and skips folders and junk', () => {
    const r = readZip(
      zip([
        { name: 'a/one.pdf', data: Buffer.from('hello') },
        { name: 'two.txt', data: Buffer.from('x'), method: 0 },
        { name: '__MACOSX/._one.pdf', data: Buffer.from('j') },
      ]),
    );
    expect(r.entries.map((e) => e.path)).toEqual(['a/one.pdf', 'two.txt']);
    expect(r.entries[0]!.data.toString()).toBe('hello');
  });

  it('CP-07 refuses path traversal, absolute paths and drive paths, even on entries that would be skipped', () => {
    for (const name of ['../evil.pdf', 'a/../../evil.pdf', '/etc/passwd', 'C:\\Windows\\x.pdf', '..\\x.pdf'])
      expect(
        code(() => readZip(zip([{ name, data: Buffer.from('x') }]))),
        name,
      ).toBe('ZIP_PATH_TRAVERSAL');
    expect(() => safeEntryPath('ok/file.pdf')).not.toThrow();
  });

  it('CP-07 refuses a zip bomb: implausible ratio, an entry that lies about its size, too many entries', () => {
    const big = Buffer.alloc(30 * 1024 * 1024);
    expect(code(() => readZip(zip([{ name: 'bomb.pdf', data: big }])))).toBe('ZIP_BOMB');
    expect(
      code(() => readZip(zip([{ name: 'liar.pdf', data: Buffer.alloc(5 * 1024 * 1024), usize: 100 }]))),
    ).toBe('ZIP_BOMB');
    const many = Array.from({ length: 101 }, (_, i) => ({ name: `f${i}.pdf`, data: Buffer.from('x') }));
    expect(code(() => readZip(zip(many)))).toBe('ZIP_TOO_MANY_ENTRIES');
    expect(code(() => readZip(Buffer.from('not a zip at all, really not')))).toBe('ZIP_INVALID');
  });

  it('CP-07 skips an oversize entry and a checksum failure is refused', () => {
    expect(
      readZip(zip([{ name: 'a.pdf', data: Buffer.alloc(16 * 1024 * 1024, 7), method: 0 }])).skipped[0]!
        .reason,
    ).toContain('larger than');
    const z = zip([{ name: 'a.pdf', data: Buffer.from('hello world'), method: 0 }]);
    z[35] = z[35]! ^ 0xff; // flip a data byte
    expect(code(() => readZip(z))).toBe('ZIP_INVALID');
  });
});

describe('CP-07 report numbers', () => {
  const item = (o: Partial<ReportItem> & { documentId: string }): ReportItem => ({
    status: 'COMMITTED',
    contractId: null,
    contractNumber: null,
    title: o.documentId,
    supplier: 'A',
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    noticeDays: 60,
    renewal: null,
    valueAmount: 100,
    valueCurrency: 'AUD',
    valueBase: 100,
    liabilityCap: null,
    clauses: [],
    liabilityClauseFound: false,
    ...o,
  });
  it('CP-07 renewals, notice windows, caps, missing clauses and concentration add up', () => {
    const rep = buildReport(
      [
        item({
          documentId: 'd1',
          supplier: 'A',
          endDate: '2026-12-01',
          noticeDays: 90,
          valueBase: 300,
          valueAmount: 300,
          liabilityCap: { basis: 'FIXED', amount: 150, currency: 'AUD' },
          clauses: [{ key: 'X', title: 'X', mandatory: true, found: false }],
        }),
        item({
          documentId: 'd2',
          supplier: 'a',
          endDate: '2027-06-01',
          valueBase: 100,
          liabilityCap: { basis: 'UNLIMITED' },
        }),
        item({
          documentId: 'd3',
          supplier: 'B',
          endDate: '2026-10-20',
          noticeDays: 10,
          valueBase: 600,
          valueAmount: 600,
          liabilityClauseFound: true,
          clauses: [{ key: 'X', title: 'X', mandatory: true, found: false }],
        }),
      ],
      '2026-10-02',
      90,
    );
    expect(rep.renewalsDue.map((r) => r.documentId)).toEqual(['d3', 'd1']);
    expect(rep.renewalsDue[1]).toMatchObject({ daysToEnd: 60, noticeDeadline: '2026-09-02' });
    expect(rep.noticeWindows.map((n) => [n.documentId, n.state])).toEqual([
      ['d1', 'PASSED'],
      ['d3', 'UPCOMING'],
    ]);
    expect(rep.liabilityCaps.summary).toEqual({
      fixed: 1,
      feesBased: 0,
      unlimited: 1,
      notStated: 1,
      belowValue: 1,
    });
    expect(rep.missingClauses).toMatchObject({
      documentsWithMissingMandatory: 2,
      byClause: [{ key: 'X', count: 2 }],
    });
    expect(rep.concentration.totalValue).toBe(1000);
    expect(rep.concentration.bySupplier).toEqual([
      { supplier: 'B', documents: 1, totalValue: 600, share: 60 },
      { supplier: 'A', documents: 2, totalValue: 400, share: 40 },
    ]);
    expect(rep.concentration.hhi).toBe(5200);
  });
  it('CP-07 sample keys are the five documented samples', () => {
    expect(SAMPLE_KEYS).toHaveLength(5);
  });
});
