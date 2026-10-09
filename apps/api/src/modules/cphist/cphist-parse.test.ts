/**
 * CP-07 historical import: the pure parts. Reading .xlsx and .csv (including hostile files), reading messy dates and amounts,
 * column mapping suggestion accuracy on the generated samples, and the validation and duplicate rules, each with failing rows.
 * No database is involved; the database behaviour is in cphist.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { abnState, parseAmountLoose, parseDateLoose, parseIntLoose } from './normalise.js';
import { suggestMapping, applySavedMapping, checkMapping } from './mapping.js';
import {
  CATALOGUE_PLANTED,
  CONTRACT_PLANTED,
  SPEND_PLANTED,
  SUPPLIER_PLANTED,
  cataloguePrices,
  legacyContractRegister,
  sampleAbn,
  sampleCsv,
  sampleXlsx,
  spendExtract,
  supplierExtract,
  templateRows,
  type SampleFile,
} from './samples.js';
import {
  MAX_FILE_BYTES,
  MAX_ROWS,
  SheetError,
  buildWorkbook,
  excelSerialToIso,
  parseTable,
} from './sheet.js';
import { validateRows, type Existing, type RowResult } from './validate.js';
import { listZip, writeZip, type ZipError } from './zip.js';
import { FIELDS } from './fields.js';

const TODAY = '2026-10-02';
const none = (over: Partial<Existing> = {}): Existing => ({
  today: TODAY,
  suppliers: [],
  contracts: new Map(),
  catalogue: new Map(),
  spend: new Set(),
  users: [
    { id: 'u1', name: 'Sofia Rossi', email: 'contract-mgr@meridian-demo.example' },
    { id: 'u2', name: 'Priya Nair', email: 'procurement@meridian-demo.example' },
  ],
  ...over,
});

const err = (fn: () => unknown): SheetError | ZipError => {
  try {
    fn();
  } catch (e) {
    return e as SheetError | ZipError;
  }
  throw new Error('expected an error');
};

const xlsxFrom = (
  sheetXml: string,
  extra: Array<{ name: string; data: string }> = [],
  sst?: string,
  declared?: number,
) =>
  writeZip([
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
    },
    ...(sst ? [{ name: 'xl/sharedStrings.xml', data: Buffer.from(sst) }] : []),
    {
      name: 'xl/worksheets/sheet1.xml',
      data: Buffer.from(sheetXml),
      ...(declared ? { declaredSize: declared } : {}),
    },
    ...extra.map((e) => ({ name: e.name, data: Buffer.from(e.data) })),
  ]);
const sheet = (rows: string) =>
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
const inline = (ref: string, t: string) => `<c r="${ref}" t="inlineStr"><is><t>${t}</t></is></c>`;

// ------------------------------------------------------------------ reading cell text
describe('CP-07 reading messy values', () => {
  it('CP-07 dates: ISO, day/month/year, two-digit years, month names, compact and serial numbers; impossible days are refused', () => {
    const ok: Array<[string, string]> = [
      ['2022-07-01', '2022-07-01'],
      ['01/07/2022', '2022-07-01'],
      ['1/7/2022', '2022-07-01'],
      ['3/4/22', '2022-04-03'], // 3 April, never 4 March
      ['31.12.2024', '2024-12-31'],
      ['1 Jul 2022', '2022-07-01'],
      ['01-Jul-22', '2022-07-01'],
      ['1st July 2022', '2022-07-01'],
      ['July 1, 2022', '2022-07-01'],
      ['20220701', '2022-07-01'],
      ['2022/7/1', '2022-07-01'],
      ['2022-07-01T00:00:00', '2022-07-01'],
      ['44743', '2022-07-01'], // an Excel serial number in a text cell
    ];
    for (const [input, want] of ok) expect(parseDateLoose(input), input).toBe(want);
    for (const bad of [
      '31/02/2023',
      '13/13/2022',
      'TBC',
      '',
      '2023-02-30',
      '0/0/0000',
      'last month',
      '12345',
    ])
      expect(parseDateLoose(bad), bad).toBeNull();
    expect(excelSerialToIso(44743)).toBe('2022-07-01');
    expect(excelSerialToIso(0)).toBeNull();
  });

  it('CP-07 amounts: dollar signs, thousands separators, currency words and brackets; words are not amounts', () => {
    expect(parseAmountLoose('$1,250,000')).toBe(1_250_000);
    expect(parseAmountLoose('AUD 90,000.50')).toBe(90_000.5);
    expect(parseAmountLoose('A$ 1 200')).toBe(1200);
    expect(parseAmountLoose('(12,345.00)')).toBe(-12_345);
    expect(parseAmountLoose('-5000')).toBe(-5000);
    expect(parseAmountLoose('1250000.00')).toBe(1_250_000);
    for (const bad of ['TBC', 'see invoice', '12k', '1.2m', '', '1,2,3x', '$'])
      expect(parseAmountLoose(bad), bad).toBeNull();
    expect(parseIntLoose('6')).toBe(6);
    expect(parseIntLoose('six')).toBeNull();
  });

  it('CP-07 ABN: the check digits are verified, spaces are allowed, and the three failures are told apart', () => {
    expect(abnState(sampleAbn(3))).toBe('VALID');
    expect(abnState('51 824 753 556')).toBe('VALID');
    expect(abnState('')).toBe('EMPTY');
    expect(abnState('51 824 753 557')).toBe('BAD_CHECKSUM');
    expect(abnState('5182475355')).toBe('BAD_FORMAT');
    expect(abnState('ABN pending')).toBe('BAD_FORMAT');
  });
});

// ------------------------------------------------------------------ reading files
describe('CP-07 reading .xlsx and .csv', () => {
  it('CP-07 a workbook written with real date cells, shared strings and deflated parts reads back as text, with dates as yyyy-mm-dd', () => {
    const wb = buildWorkbook('Register', [
      ['No', 'Start', 'Value', 'Note'],
      ['A-1', { date: '2022-07-01' }, 1200.5, 'a & b <c>'],
      ['A-2', { date: '2024-02-29' }, 90, ''],
    ]);
    const t = parseTable(wb, 'register.xlsx');
    expect(t).toMatchObject({
      kind: 'XLSX',
      sheetName: 'Register',
      headers: ['No', 'Start', 'Value', 'Note'],
    });
    expect(t.rows).toEqual([
      ['A-1', '2022-07-01', '1200.5', 'a & b <c>'],
      ['A-2', '2024-02-29', '90', ''],
    ]);
  });

  it('CP-07 the xlsx and csv versions of the legacy register hold the same 200 rows, and every date format in them reads to a date', () => {
    const s = legacyContractRegister();
    const x = parseTable(sampleXlsx(s), 'legacy.xlsx');
    const c = parseTable(Buffer.from(sampleCsv(s)), 'legacy.csv');
    expect(x.headers).toEqual(s.headers);
    expect(c.headers).toEqual(s.headers);
    expect(x.rows).toHaveLength(200);
    expect(c.rows).toHaveLength(200);
    const planted = new Set([...CONTRACT_PLANTED.badStartDate, ...CONTRACT_PLANTED.dateOrder]);
    const formats = new Set<string>();
    for (let i = 0; i < 200; i++) {
      if (planted.has(i + 1)) continue;
      const a = parseDateLoose(x.rows[i]![4]);
      const b = parseDateLoose(c.rows[i]![4]);
      expect(a, `row ${i + 1}: ${x.rows[i]![4]}`).not.toBeNull();
      expect(a).toBe(b);
      formats.add(
        /^\d{4}-/.test(c.rows[i]![4]!)
          ? 'iso'
          : /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(c.rows[i]![4]!)
            ? 'dmy2'
            : /[A-Za-z]/.test(c.rows[i]![4]!)
              ? 'words'
              : 'dmy4',
      );
    }
    expect(formats).toEqual(new Set(['iso', 'dmy2', 'words', 'dmy4']));
  });

  it('CP-07 csv: quoted fields, a byte order mark, semicolon and tab separators, blank lines above the header are skipped', () => {
    const a = parseTable(Buffer.from('﻿a,b\r\n"x, y","say ""hi"""\r\n'), 'a.csv');
    expect(a.rows).toEqual([['x, y', 'say "hi"']]);
    expect(parseTable(Buffer.from('a;b\n1;2\n'), 'b.csv')).toMatchObject({
      headers: ['a', 'b'],
      rows: [['1', '2']],
    });
    expect(parseTable(Buffer.from('a\tb\n1\t2\n'), 'c.csv').rows).toEqual([['1', '2']]);
    const withTitle = parseTable(Buffer.from('Exported 2026\n\nName,Value\nA,1\n'), 'd.csv');
    expect(withTitle.headers).toEqual(['Name', 'Value']);
    expect(withTitle.warnings.join(' ')).toContain('above the header');
    // a trailing empty header is dropped; an empty one in the middle is named
    expect(parseTable(Buffer.from('a,a,\n1,2,3\n'), 'e.csv').headers).toEqual(['a', 'a (2)']);
    expect(parseTable(Buffer.from('a,,c\n1,2,3\n'), 'f.csv').headers).toEqual(['a', 'Column 2', 'c']);
  });

  it('CP-07 a formula cell is read as the value stored in the file and never calculated, and is reported', () => {
    const xml = sheet(
      `<row r="1">${inline('A1', 'Name')}${inline('B1', 'Total')}</row>` +
        `<row r="2">${inline('A2', 'x')}<c r="B2"><f>1+1</f><v>42</v></c></row>` +
        `<row r="3">${inline('A3', 'y')}<c r="B3"><f>HYPERLINK("http://evil.example","x")</f></c></row>`,
    );
    const t = parseTable(xlsxFrom(xml), 'f.xlsx');
    expect(t.rows).toEqual([
      ['x', '42'],
      ['y', ''],
    ]);
    expect(t.warnings.join(' ')).toMatch(/2 formula cell\(s\)/);
    expect(t.warnings.join(' ')).toMatch(/no stored value/);
  });

  it('CP-07 hostile: a macro workbook is read for its values, the macro is ignored and reported, never opened', () => {
    const wb = buildWorkbook(
      'Data',
      [
        ['a', 'b'],
        ['1', '2'],
      ],
      { macros: true },
    );
    const t = parseTable(wb, 'macro.xlsm');
    expect(t.rows).toEqual([['1', '2']]);
    expect(t.warnings.join(' ')).toContain('macros');
  });

  it('CP-07 hostile: a zip bomb (a member that expands to a thousand times its size) is refused before anything is expanded', () => {
    const big = Buffer.alloc(30 * 1024 * 1024, 0x20);
    const bomb = writeZip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') },
      { name: 'xl/worksheets/sheet1.xml', data: big },
    ]);
    expect(bomb.length).toBeLessThan(200_000);
    const e = err(() => parseTable(bomb, 'bomb.xlsx'));
    expect(e).toBeInstanceOf(SheetError);
    expect((e as SheetError).code).toBe('FILE_UNSAFE');
    // a member whose header says it is small but really expands further is stopped at its declared size
    const lie = xlsxFrom(
      sheet(
        `<row r="1">${inline('A1', 'a')}${inline('B1', 'b')}</row>` +
          `<row r="2"><c r="A2"><v>1</v></c></row>`.repeat(150_000),
      ),
      [],
      undefined,
      1000,
    );
    expect((err(() => parseTable(lie, 'lie.xlsx')) as SheetError).code).toBe('FILE_UNSAFE');
    // many small members
    const many = writeZip(
      Array.from({ length: 500 }, (_, i) => ({ name: `f${i}.xml`, data: Buffer.from('<a/>') })),
    );
    expect(err(() => listZip(many)).message).toMatch(/entries/);
  });

  it('CP-07 hostile: an oversized upload, an encrypted member, ZIP64, an old .xls, a binary file and an entity declaration are all refused with a reason', () => {
    expect(
      (err(() => parseTable(Buffer.alloc(MAX_FILE_BYTES + 1, 0x41), 'big.csv')) as SheetError).code,
    ).toBe('FILE_TOO_LARGE');
    expect((err(() => parseTable(Buffer.alloc(0), 'empty.csv')) as SheetError).code).toBe('NO_DATA');
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(100),
    ]);
    expect((err(() => parseTable(ole, 'old.xls')) as SheetError).code).toBe('FILE_TYPE_UNSUPPORTED');
    expect((err(() => parseTable(Buffer.from([1, 2, 0, 0, 3, 4, 5, 0]), 'x.csv')) as SheetError).code).toBe(
      'FILE_TYPE_UNSUPPORTED',
    );
    expect(
      (err(() => parseTable(writeZip([{ name: 'a.txt', data: Buffer.from('hi') }]), 'x.xlsx')) as SheetError)
        .code,
    ).toBe('FILE_TYPE_UNSUPPORTED');
    const enc = Buffer.from(writeZip([{ name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') }]));
    const cen = enc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    enc.writeUInt16LE(1, cen + 8); // general purpose flag bit 0: encrypted
    expect((err(() => parseTable(enc, 'enc.xlsx')) as SheetError).message).toMatch(/Encrypted/);
    const entity = xlsxFrom(
      sheet(
        `<row r="1">${inline('A1', 'a')}${inline('B1', 'b')}</row><row r="2">${inline('A2', '1')}${inline('B2', '2')}</row>`,
      ),
      [],
      '<!DOCTYPE sst [<!ENTITY a "aaaa">]><sst><si><t>&a;</t></si></sst>',
    );
    expect((err(() => parseTable(entity, 'xxe.xlsx')) as SheetError).code).toBe('FILE_UNSAFE');
    const z64 = Buffer.from(writeZip([{ name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') }]));
    z64.writeUInt16LE(0xffff, z64.length - 12);
    expect(err(() => listZip(z64)).message).toMatch(/ZIP64/);
  });

  it('CP-07 hostile: more rows or columns than the limit are refused, and a header-only file says so', () => {
    const rows = Array.from(
      { length: MAX_ROWS + 5 },
      (_, i) => `<row r="${i + 2}">${inline(`A${i + 2}`, 'v')}${inline(`B${i + 2}`, 'w')}</row>`,
    ).join('');
    const tooMany = xlsxFrom(sheet(`<row r="1">${inline('A1', 'a')}${inline('B1', 'b')}</row>${rows}`));
    expect((err(() => parseTable(tooMany, 'rows.xlsx')) as SheetError).code).toBe('TOO_MANY_ROWS');
    const wide = Array.from({ length: 130 }, (_, i) => `h${i}`).join(',');
    expect((err(() => parseTable(Buffer.from(`${wide}\n1\n`), 'wide.csv')) as SheetError).code).toBe(
      'TOO_MANY_COLUMNS',
    );
    expect((err(() => parseTable(Buffer.from('a,b\n'), 'h.csv')) as SheetError).message).toMatch(
      /no data rows/,
    );
  });

  it('CP-07 the downloadable templates are readable and have one column per field', () => {
    for (const e of ['CONTRACTS', 'SUPPLIERS', 'SPEND', 'CATALOGUE'] as const) {
      const t = templateRows(e);
      const parsedX = parseTable(buildWorkbook(e, [t.headers, ...t.rows]), 't.xlsx');
      const parsedC = parseTable(Buffer.from(sampleCsv(t)), 't.csv');
      expect(parsedX.headers).toEqual(FIELDS[e].map((f) => f.label));
      expect(parsedC.rows).toHaveLength(1);
      // a template upload maps perfectly by its own labels
      const m = suggestMapping(e, parsedX.headers, parsedX.rows);
      expect(m.missingRequired).toEqual([]);
    }
  });
});

// ------------------------------------------------------------------ mapping suggestion
describe('CP-07 column mapping suggestion', () => {
  const samples: SampleFile[] = [
    legacyContractRegister(),
    supplierExtract(),
    spendExtract(),
    cataloguePrices(),
  ];
  for (const s of samples)
    it(`CP-07 ${s.key}: every expected column is suggested for the right field, from both the xlsx and the csv`, () => {
      for (const t of [parseTable(sampleXlsx(s), 'x.xlsx'), parseTable(Buffer.from(sampleCsv(s)), 'x.csv')]) {
        const m = suggestMapping(s.entity, t.headers, t.rows);
        const got: Record<string, string> = {};
        for (const [field, header] of Object.entries(m.mapping)) if (header) got[header] = field;
        let right = 0;
        for (const [header, field] of Object.entries(s.expected)) if (got[header] === field) right += 1;
        expect(right / Object.keys(s.expected).length, JSON.stringify({ got, expected: s.expected })).toBe(1);
        expect(m.missingRequired).toEqual([]);
        expect(m.engine).toBe('rules-simulated-v1');
        expect(Object.keys(m.alternatives).length).toBeGreaterThan(3);
      }
    });

  it('CP-07 synonyms and word order are understood; a column of dates is not offered as the contract value', () => {
    const headers = [
      'Ref No',
      'Description',
      'Supplier Name',
      'Date From',
      'Date To',
      'Total Contract Value',
      'Contract Owner',
    ];
    const rows = [['R1', 'Cleaning', 'Apex Cleaning', '01/07/2022', '30/06/2025', '$100,000', 'Sofia Rossi']];
    const m = suggestMapping('CONTRACTS', headers, rows).mapping;
    expect(m).toMatchObject({
      contract_number: 'Ref No',
      supplier: 'Supplier Name',
      start_date: 'Date From',
      end_date: 'Date To',
      value: 'Total Contract Value',
      owner: 'Contract Owner',
    });
    // two date columns with unhelpful names: values decide that they are dates, not which is which, so nothing is forced onto the amount
    const odd = suggestMapping('CONTRACTS', ['Col A', 'Col B', 'Col C'], [['x', '01/01/2020', '$5,000']]);
    expect(odd.mapping.value === 'Col B').toBe(false);
  });

  it('CP-07 a typo in a header still maps; an unrelated header is left unmapped', () => {
    const m = suggestMapping('CONTRACTS', ['Suplier', 'Expiray Date', 'Banana'], [['A', '01/01/2030', 'z']]);
    expect(m.mapping.supplier).toBe('Suplier');
    expect(m.mapping.end_date).toBe('Expiray Date');
    expect(m.unmapped).toContain('Banana');
  });

  it('CP-07 an edited mapping is checked: unknown field, missing column, a column used twice, a missing required field', () => {
    const headers = ['a', 'b'];
    const problems = checkMapping(
      'SUPPLIERS',
      { company: 'a', abn: 'a', nonsense: 'b', city: 'zzz' },
      headers,
    );
    const text = problems.map((p) => `${p.field}: ${p.message}`).join('\n');
    expect(text).toContain('abn: Column "a" is already used');
    expect(text).toContain('nonsense: "nonsense" is not a field');
    expect(text).toContain('city: The file has no column "zzz"');
    expect(checkMapping('SUPPLIERS', { abn: 'a' }, headers).map((p) => p.field)).toContain('company');
    expect(checkMapping('SUPPLIERS', { company: 'a', abn: 'b' }, headers)).toEqual([]);
  });

  it('CP-07 a saved mapping is applied by header name (any case) and says which headers it could not find', () => {
    const r = applySavedMapping({ company: 'Name 1', abn: 'ABN', city: 'Town' }, ['name 1', 'ABN', 'Region']);
    expect(r.mapping).toEqual({ company: 'name 1', abn: 'ABN', city: null });
    expect(r.missingHeaders).toEqual(['Town']);
  });
});

// ------------------------------------------------------------------ validation rules
function validateSample(s: SampleFile, existing: Existing = none()) {
  const t = parseTable(Buffer.from(sampleCsv(s)), 'x.csv');
  const m = suggestMapping(s.entity, t.headers, t.rows).mapping;
  const out = validateRows({
    entity: s.entity,
    mapping: m,
    rows: t.rows.map((cells, i) => ({
      rowNo: i + 1,
      raw: Object.fromEntries(t.headers.map((h, c) => [h, cells[c] ?? ''])),
    })),
    existing,
  });
  const at = (n: number): RowResult => out.rows[n - 1]!;
  const rules = (n: number) => at(n).issues.map((i) => i.rule);
  return { out, at, rules };
}

describe('CP-07 validation: every rule, with the planted failing rows of the 200-row legacy register', () => {
  const existing = none({
    contracts: new Map([['ct-2026-0001', { id: 'c1', label: 'CT-2026-0001 Existing' }]]),
  });
  const v = validateSample(legacyContractRegister(), existing);
  const P = CONTRACT_PLANTED;

  it('CP-07 dates in other formats are accepted; unreadable dates are DATE_FORMAT errors', () => {
    for (const n of P.badStartDate) {
      expect(v.rules(n), `row ${n}`).toContain('DATE_FORMAT');
      expect(v.at(n).issues.find((i) => i.rule === 'DATE_FORMAT')!.field).toBe('start_date');
      expect(v.at(n).status).toBe('ERROR');
    }
    // a day/month/year row and a month-name row load without a date problem
    expect(v.at(1).status === 'VALID' || v.at(1).issues.every((i) => !i.rule.startsWith('DATE'))).toBe(true);
  });

  it('CP-07 an end date before the start is DATE_ORDER; an empty required field is REQUIRED', () => {
    for (const n of P.dateOrder) expect(v.rules(n)).toContain('DATE_ORDER');
    for (const n of P.missingSupplier)
      expect(v.at(n).issues.find((i) => i.rule === 'REQUIRED')).toMatchObject({ field: 'supplier' });
    for (const n of P.missingEndDate)
      expect(v.at(n).issues.find((i) => i.rule === 'REQUIRED')).toMatchObject({ field: 'end_date' });
  });

  it('CP-07 an ABN that fails the check digits or is not 11 digits is ABN_CHECKSUM', () => {
    for (const n of P.badAbn) expect(v.rules(n), `row ${n}`).toContain('ABN_CHECKSUM');
  });

  it('CP-07 an amount that is not a number is AMOUNT_FORMAT; a negative contract value is AMOUNT_RANGE', () => {
    for (const n of P.badValue) expect(v.rules(n)).toContain('AMOUNT_FORMAT');
    for (const n of P.negativeValue) expect(v.rules(n)).toContain('AMOUNT_RANGE');
  });

  it('CP-07 a status outside the allowed list is ALLOWED_VALUE; a notice period that is not a number is INTEGER', () => {
    for (const n of P.badStatus)
      expect(v.at(n).issues.find((i) => i.rule === 'ALLOWED_VALUE')).toMatchObject({ field: 'status' });
    for (const n of P.badNotice) expect(v.rules(n)).toContain('INTEGER');
  });

  it('CP-07 duplicates: a number repeated in the file is DUPLICATE_IN_FILE (pointing at the first), one already in the system is DUPLICATE_EXISTING', () => {
    for (const n of P.duplicateInFile) {
      expect(v.at(n).status).toBe('DUPLICATE');
      expect(v.at(n).duplicate).toMatchObject({ kind: 'IN_FILE', ofRow: 15 });
      expect(v.rules(n)).toContain('DUPLICATE_IN_FILE');
    }
    for (const n of P.duplicateExisting) {
      expect(v.at(n).status).toBe('DUPLICATE');
      expect(v.at(n).duplicate).toMatchObject({ kind: 'EXISTING', entityId: 'c1' });
    }
  });

  it('CP-07 the rest of the 200 rows are valid, and every planted row is the only reason for the count of errors', () => {
    const planted = new Set(Object.values(P).flat());
    const valid = v.out.rows.filter((r) => r.status === 'VALID').length;
    const stopped = v.out.rows.filter((r) => r.status !== 'VALID').length;
    expect(stopped).toBe(planted.size);
    expect(valid).toBe(200 - planted.size);
    for (const r of v.out.rows)
      if (!planted.has(r.rowNo))
        expect(r.status, `row ${r.rowNo}: ${JSON.stringify(r.issues)}`).toBe('VALID');
  });

  it('CP-07 supplier names that are spelled differently are reported as variants; owners that are not users and missing notice get warnings', () => {
    // spellings that are the same business after the usual clean-up (Pty Ltd, P/L, punctuation) load as ONE supplier; look-alikes are flagged
    expect(v.out.variants.length).toBeGreaterThanOrEqual(1);
    const names = v.out.variants.flatMap((x) => x.names);
    expect(names.some((n) => /bright/i.test(n))).toBe(true);
    const spellings = new Set(
      v.out.rows.filter((r) => r.status === 'VALID').map((r) => String(r.values!.supplier)),
    );
    expect(spellings.size).toBeGreaterThan(v.out.suppliersNew + 3);
    const rule = (r: string) => v.out.rows.filter((x) => x.warnings.some((w) => w.rule === r)).length;
    expect(rule('SUPPLIER_VARIANT')).toBeGreaterThan(0);
    expect(rule('OWNER_NOT_FOUND')).toBeGreaterThan(0);
    expect(rule('NO_OWNER')).toBeGreaterThan(0);
    expect(rule('CONTRACT_ENDED')).toBeGreaterThan(0);
    expect(rule('TERMINATED')).toBeGreaterThan(0);
    // suppliers a load would create: one per business, not per spelling
    expect(v.out.suppliersNew).toBeGreaterThan(20);
    expect(v.out.suppliersNew).toBeLessThan(45);
  });

  it('CP-07 a contract value of zero, a term over 40 years and a text longer than its limit are refused', () => {
    const headers = ['n', 't', 's', 'a', 'b', 'v'];
    const mk = (cells: string[]) => ({
      rowNo: 1,
      raw: Object.fromEntries(headers.map((h, i) => [h, cells[i]!])),
    });
    const map = {
      contract_number: 'n',
      title: 't',
      supplier: 's',
      start_date: 'a',
      end_date: 'b',
      value: 'v',
    };
    const run = (cells: string[]) =>
      validateRows({ entity: 'CONTRACTS', mapping: map, rows: [mk(cells)], existing: none() }).rows[0]!;
    expect(run(['N1', 'T', 'S', '2020-01-01', '2030-01-01', '0']).issues.map((i) => i.rule)).toContain(
      'AMOUNT_RANGE',
    );
    expect(run(['N1', 'T', 'S', '1990-01-01', '2050-01-01', '5']).issues.map((i) => i.rule)).toContain(
      'DATE_RANGE',
    );
    expect(
      run(['N'.repeat(61), 'T', 'S', '2020-01-01', '2030-01-01', '5']).issues.map((i) => i.rule),
    ).toContain('TEXT_LENGTH');
    expect(run(['N1', 'T', 'S', '2020-01-01', '2030-01-01', '5']).status).toBe('VALID');
  });
});

describe('CP-07 validation: suppliers, spend and catalogue samples', () => {
  it('CP-07 supplier extract: bad ABNs, a missing name, a bad email, repeats of the same ABN and of the same name, and a look-alike', () => {
    const P = SUPPLIER_PLANTED;
    const v = validateSample(supplierExtract());
    for (const n of P.badAbn) expect(v.rules(n)).toContain('ABN_CHECKSUM');
    for (const n of P.missingName)
      expect(v.at(n).issues.find((i) => i.rule === 'REQUIRED')).toMatchObject({ field: 'company' });
    for (const n of P.badEmail) expect(v.rules(n)).toContain('EMAIL');
    for (const n of P.missingAbn) expect(v.at(n).warnings.map((w) => w.rule)).toContain('NO_ABN');
    expect(v.at(31).duplicate).toMatchObject({ kind: 'IN_FILE', ofRow: 1 }); // the same ABN under another spelling
    expect(v.at(32).duplicate).toMatchObject({ kind: 'IN_FILE', ofRow: 2 }); // the same name with no ABN
    expect(v.at(33).status).toBe('VALID'); // a look-alike is a warning, not a duplicate
    expect(v.at(33).warnings.map((w) => w.rule)).toContain('SUPPLIER_VARIANT');
  });

  it('CP-07 supplier extract: a supplier already on file is a DUPLICATE_EXISTING by ABN and by name', () => {
    const s = supplierExtract();
    const row1Abn = String(s.rows[0]![2]);
    const v = validateSample(
      s,
      none({
        suppliers: [
          { id: 's1', company: 'Some Other Name Ltd', abn: row1Abn },
          { id: 's2', company: String(s.rows[1]![1]), abn: '00000000000' },
        ],
      }),
    );
    expect(v.at(1).duplicate).toMatchObject({ kind: 'EXISTING', entityId: 's1' });
    expect(v.at(2).duplicate).toMatchObject({ kind: 'EXISTING', entityId: 's2' });
  });

  it('CP-07 spend extract: bad and future dates, bad and zero amounts, a missing supplier, a repeated line, a credit; and a line already loaded', () => {
    const P = SPEND_PLANTED;
    const v = validateSample(spendExtract());
    for (const n of P.badDate) expect(v.rules(n)).toContain('DATE_FORMAT');
    for (const n of P.futureDate) expect(v.rules(n)).toContain('DATE_FUTURE');
    for (const n of P.badAmount) expect(v.rules(n)).toContain('AMOUNT_FORMAT');
    for (const n of P.zeroAmount) expect(v.rules(n)).toContain('AMOUNT_RANGE');
    for (const n of P.missingSupplier) expect(v.rules(n)).toContain('REQUIRED');
    for (const n of P.duplicateInFile)
      expect(v.at(n).duplicate).toMatchObject({ kind: 'IN_FILE', ofRow: 19 });
    for (const n of P.credit) expect(v.at(n).warnings.map((w) => w.rule)).toContain('CREDIT');
    expect(v.out.rows.filter((r) => r.status === 'VALID').length).toBe(
      300 - new Set(Object.values(P).flat()).size + P.credit.length,
    );
    // loaded before: the same supplier, date, amount and reference
    const row5 = v.at(5).values!;
    const sig = [
      String(row5.supplier)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(pty|ltd|limited|co|company)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      row5.date,
      Number(row5.amount).toFixed(2),
      String(row5.reference).toLowerCase(),
    ].join('|');
    const again = validateSample(spendExtract(), none({ spend: new Set([sig]) }));
    expect(again.at(5).duplicate).toMatchObject({ kind: 'EXISTING' });
  });

  it('CP-07 catalogue: an unknown supplier is SUPPLIER_NOT_FOUND, a bad price, a missing SKU, and a repeated SKU for one supplier', () => {
    const P = CATALOGUE_PLANTED;
    const s = cataloguePrices();
    const suppliers = [9, 4, 16, 0, 12].map((i, k) => ({ id: `s${k}`, company: '', abn: sampleAbn(i + 1) }));
    // the sample's suppliers by name
    const names = new Set(s.rows.map((r) => String(r[0])));
    const have = [...names]
      .filter((n) => n !== 'Nonexistent Trading Pty Ltd')
      .map((company, k) => ({ id: `s${k}`, company, abn: suppliers[k % 5]!.abn }));
    const v = validateSample(s, none({ suppliers: have }));
    for (const n of P.unknownSupplier) expect(v.rules(n)).toContain('SUPPLIER_NOT_FOUND');
    for (const n of P.badPrice) expect(v.rules(n)).toContain('AMOUNT_FORMAT');
    for (const n of P.missingSku) expect(v.rules(n)).toContain('REQUIRED');
    for (const n of P.duplicateInFile)
      expect(v.at(n).duplicate).toMatchObject({ kind: 'IN_FILE', ofRow: 12 });
  });
});
