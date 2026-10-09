/**
 * Synthetic sample files and templates for the historical import (CP-07). Everything here is invented: made-up businesses
 * with ABNs that pass the check-digit test, a fixed random sequence so the files are identical on every run, and defects
 * planted at known data rows (the `PLANTED` tables) so tests and demonstrations can say exactly what the dry run must find.
 */
import { FIELDS } from './fields.js';
import { buildWorkbook, type Cell } from './sheet.js';
import type { HistEntity } from '../../db/schema-cpd.js';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
/** An ABN that passes the check-digit test, from a number. */
export function sampleAbn(n: number): string {
  const body = String(10_000_000 + n * 7_919)
    .padStart(9, '0')
    .slice(0, 9);
  for (let c = 10; c < 100; c++) {
    const abn = `${c}${body}`;
    const sum = [...abn].reduce((acc, ch, i) => acc + (i === 0 ? Number(ch) - 1 : Number(ch)) * W[i]!, 0);
    if (sum % 89 === 0) return abn;
  }
  return '51824753556';
}
const breakAbn = (abn: string) => abn.slice(0, 10) + String((Number(abn[10]) + 3) % 10);

/** The supplier names of the samples: each business, and the spellings a legacy register holds for it. */
export const SAMPLE_SUPPLIERS: Array<{
  name: string;
  variants: string[];
  city: string;
  state: string;
  category: string;
}> = [
  {
    name: 'Apex Cleaning Pty Ltd',
    variants: ['APEX CLEANING PTY. LTD.', 'Apex Cleaning Services Pty Ltd'],
    city: 'Brisbane',
    state: 'QLD',
    category: 'Facilities',
  },
  {
    name: 'Brightline Security Pty Ltd',
    variants: ['Brightline Security P/L', 'Bright-line Security Pty Ltd'],
    city: 'Sydney',
    state: 'NSW',
    category: 'Security',
  },
  {
    name: 'Cobalt IT Services Pty Ltd',
    variants: ['Cobalt I.T. Services Pty Ltd'],
    city: 'Melbourne',
    state: 'VIC',
    category: 'IT services',
  },
  {
    name: 'Driftwood Catering Co',
    variants: ['Driftwood Catering Company'],
    city: 'Perth',
    state: 'WA',
    category: 'Catering',
  },
  {
    name: 'Eastgate Print and Mail Pty Ltd',
    variants: ['Eastgate Print & Mail Pty Ltd'],
    city: 'Adelaide',
    state: 'SA',
    category: 'Print',
  },
  { name: 'Fernhill Landscaping Pty Ltd', variants: [], city: 'Hobart', state: 'TAS', category: 'Grounds' },
  {
    name: 'Granite Ridge Engineering Pty Ltd',
    variants: ['Granite Ridge Engineering Limited'],
    city: 'Canberra',
    state: 'ACT',
    category: 'Engineering',
  },
  { name: 'Harbourview Legal Services', variants: [], city: 'Sydney', state: 'NSW', category: 'Legal' },
  {
    name: 'Ironbark Fleet Management Pty Ltd',
    variants: ['Ironbark Fleet Mgmt Pty Ltd'],
    city: 'Darwin',
    state: 'NT',
    category: 'Fleet',
  },
  {
    name: 'Juniper Office Supplies Pty Ltd',
    variants: [],
    city: 'Brisbane',
    state: 'QLD',
    category: 'Office supplies',
  },
  {
    name: 'Kestrel Telecom Pty Ltd',
    variants: ['Kestrel Telecommunications Pty Ltd'],
    city: 'Melbourne',
    state: 'VIC',
    category: 'Telecommunications',
  },
  { name: 'Lakeside Training Group', variants: [], city: 'Perth', state: 'WA', category: 'Training' },
  {
    name: 'Meridian Waste Solutions Pty Ltd',
    variants: [],
    city: 'Adelaide',
    state: 'SA',
    category: 'Waste',
  },
  {
    name: 'Northgate Medical Supplies Pty Ltd',
    variants: ['Northgate Medical Supply Pty Ltd'],
    city: 'Sydney',
    state: 'NSW',
    category: 'Medical',
  },
  {
    name: 'Orchard Hill Consulting Pty Ltd',
    variants: [],
    city: 'Canberra',
    state: 'ACT',
    category: 'Consulting',
  },
  {
    name: 'Pinecrest Software Pty Ltd',
    variants: ['Pinecrest Software P/L'],
    city: 'Melbourne',
    state: 'VIC',
    category: 'Software',
  },
  {
    name: 'Quartz Facilities Management',
    variants: [],
    city: 'Brisbane',
    state: 'QLD',
    category: 'Facilities',
  },
  {
    name: 'Redwood Courier Services Pty Ltd',
    variants: [],
    city: 'Sydney',
    state: 'NSW',
    category: 'Courier',
  },
  {
    name: 'Silverleaf Security Systems Pty Ltd',
    variants: [],
    city: 'Hobart',
    state: 'TAS',
    category: 'Security',
  },
  {
    name: 'Tidewater Marine Services Pty Ltd',
    variants: [],
    city: 'Darwin',
    state: 'NT',
    category: 'Marine',
  },
  {
    name: 'Upland Data Storage Pty Ltd',
    variants: ['Upland Data Storage Limited'],
    city: 'Melbourne',
    state: 'VIC',
    category: 'IT services',
  },
  { name: 'Valley Road Plumbing Pty Ltd', variants: [], city: 'Perth', state: 'WA', category: 'Maintenance' },
  {
    name: 'Westbrook Electrical Pty Ltd',
    variants: [],
    city: 'Adelaide',
    state: 'SA',
    category: 'Maintenance',
  },
  {
    name: 'Yarra Bend Advisory Pty Ltd',
    variants: [],
    city: 'Melbourne',
    state: 'VIC',
    category: 'Consulting',
  },
  {
    name: 'Zenith Recruitment Pty Ltd',
    variants: ['Zenith Recruitment Australia Pty Ltd'],
    city: 'Sydney',
    state: 'NSW',
    category: 'Recruitment',
  },
  {
    name: 'Alder Street Pathology Pty Ltd',
    variants: [],
    city: 'Brisbane',
    state: 'QLD',
    category: 'Medical',
  },
  { name: 'Birchwood Furniture Pty Ltd', variants: [], city: 'Adelaide', state: 'SA', category: 'Furniture' },
  {
    name: 'Coastline Travel Management Pty Ltd',
    variants: [],
    city: 'Sydney',
    state: 'NSW',
    category: 'Travel',
  },
  { name: 'Delta Pump Hire Pty Ltd', variants: [], city: 'Darwin', state: 'NT', category: 'Equipment hire' },
  { name: 'Emberly Print Studio', variants: [], city: 'Hobart', state: 'TAS', category: 'Print' },
];
const ABN_OF = (i: number) => sampleAbn(i + 1);

const OWNERS = [
  'Sofia Rossi',
  'Priya Nair',
  'Henry Albright',
  'Sofia Rossi',
  'Unknown Person',
  '',
  'Grace Mwangi',
];
const WORDING = [
  'Either party may terminate on three months written notice. The Supplier shall deliver monthly service reports. KPI: 95% of requests closed within agreed times.',
  'Termination for convenience on 90 days notice. The Supplier must hold current public liability insurance. SLA: response within 4 hours.',
  'Either party may terminate on six months written notice. The Customer has two further 12-month options to extend. The Supplier shall provide quarterly performance reviews.',
  '',
  '',
];
const STATUSES = ['Active', 'Active', 'Active', 'Current', 'Expired', 'Terminated', ''];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const addYears = (iso: string, y: number) =>
  isoOf(Number(iso.slice(0, 4)) + y, Number(iso.slice(5, 7)), Math.min(28, Number(iso.slice(8, 10))));

/** One date in one of the ways legacy registers write them. `style` cycles so every format is present. */
function dateCell(iso: string, style: number): Cell {
  const [y, m, d] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
  switch (style % 5) {
    case 0:
      return { date: iso };
    case 1:
      return `${pad(d)}/${pad(m)}/${y}`;
    case 2:
      return iso;
    case 3:
      return `${d} ${MONTHS[m - 1]} ${y}`;
    default:
      return `${d}/${m}/${String(y).slice(2)}`;
  }
}

export interface SampleFile {
  /** Short name used in file names and routes. */
  key: string;
  entity: HistEntity;
  headers: string[];
  rows: Cell[][];
  /** What the source system is called in the saved mapping. */
  sourceSystem: string;
  /** The field each header is expected to map to (the mapping suggestion is tested against this). */
  expected: Record<string, string>;
  /** Data row numbers (1-based) carrying each planted defect. */
  planted: Record<string, number[]>;
}

// ------------------------------------------------------------------ legacy contract register (200 rows)
export const CONTRACT_PLANTED = {
  badStartDate: [7, 45, 133],
  dateOrder: [22],
  missingSupplier: [31, 88],
  missingEndDate: [58],
  badAbn: [12, 70, 171, 99],
  badValue: [64],
  negativeValue: [101],
  badStatus: [77],
  badNotice: [90],
  duplicateInFile: [120],
  duplicateExisting: [150],
};

export function legacyContractRegister(): SampleFile {
  const r = rng(20260701);
  const headers = [
    'Agreement No.',
    'Agreement Title',
    'Vendor',
    'Vendor ABN',
    'Commencement',
    'Expiry Date',
    'TCV (AUD)',
    'Contract Manager',
    'Notice (months)',
    'Status',
    'Key Terms',
  ];
  const rows: Cell[][] = [];
  const P = CONTRACT_PLANTED;
  for (let n = 1; n <= 200; n++) {
    const sIdx = Math.floor(r() * SAMPLE_SUPPLIERS.length);
    const sup = SAMPLE_SUPPLIERS[sIdx]!;
    // the register holds the supplier under whichever spelling the clerk typed that day
    const spell =
      r() < 0.3 && sup.variants.length ? sup.variants[Math.floor(r() * sup.variants.length)]! : sup.name;
    const startY = 2019 + Math.floor(r() * 7);
    const start = isoOf(startY, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28));
    let end = addYears(start, 2 + Math.floor(r() * 4));
    const value = Math.round((20_000 + r() * 2_400_000) / 100) * 100;
    const vStyle = n % 4;
    let valueCell: Cell =
      vStyle === 0
        ? value
        : vStyle === 1
          ? `$${value.toLocaleString('en-AU')}`
          : vStyle === 2
            ? `AUD ${value.toLocaleString('en-AU')}`
            : value.toFixed(2);
    let startCell: Cell = dateCell(start, n);
    let endCell: Cell = dateCell(end, n + 2);
    let abn: Cell =
      r() < 0.12
        ? ''
        : r() < 0.5
          ? ABN_OF(sIdx)
          : `${ABN_OF(sIdx).slice(0, 2)} ${ABN_OF(sIdx).slice(2, 5)} ${ABN_OF(sIdx).slice(5, 8)} ${ABN_OF(sIdx).slice(8)}`;
    let supplier: Cell = spell;
    let status: Cell = STATUSES[Math.floor(r() * STATUSES.length)]!;
    let notice: Cell = r() < 0.5 ? String([1, 2, 3, 6][Math.floor(r() * 4)]) : '';
    let number = `AG-${String(n).padStart(4, '0')}`;
    const title = `${sup.category} services (${startY})`;
    if (P.badStartDate.includes(n)) startCell = n === 7 ? '31/02/2023' : n === 45 ? 'TBC' : '13/13/2022';
    if (P.dateOrder.includes(n)) {
      endCell = dateCell(addYears(start, -1), n);
      end = addYears(start, -1);
    }
    if (P.missingSupplier.includes(n)) supplier = '';
    if (P.missingEndDate.includes(n)) endCell = '';
    if (P.badAbn.includes(n)) abn = n === 99 ? ABN_OF(sIdx).slice(0, 10) : breakAbn(ABN_OF(sIdx));
    if (P.badValue.includes(n)) valueCell = 'TBC';
    if (P.negativeValue.includes(n)) valueCell = '-5000';
    if (P.badStatus.includes(n)) status = 'Pending approval';
    if (P.badNotice.includes(n)) notice = 'six';
    if (P.duplicateInFile.includes(n)) number = 'AG-0015';
    if (P.duplicateExisting.includes(n)) number = 'CT-2026-0001';
    rows.push([
      number,
      title,
      supplier,
      abn,
      startCell,
      endCell,
      valueCell,
      OWNERS[Math.floor(r() * OWNERS.length)]!,
      notice,
      status,
      WORDING[Math.floor(r() * WORDING.length)]!,
    ]);
    void end;
  }
  return {
    key: 'legacy-contract-register',
    entity: 'CONTRACTS',
    headers,
    rows,
    sourceSystem: 'Legacy contract register',
    expected: {
      'Agreement No.': 'contract_number',
      'Agreement Title': 'title',
      Vendor: 'supplier',
      'Vendor ABN': 'supplier_abn',
      Commencement: 'start_date',
      'Expiry Date': 'end_date',
      'TCV (AUD)': 'value',
      'Contract Manager': 'owner',
      'Notice (months)': 'notice_months',
      Status: 'status',
      'Key Terms': 'text',
    },
    planted: CONTRACT_PLANTED,
  };
}

// ------------------------------------------------------------------ supplier extract (SAP-style vendor master)
export const SUPPLIER_PLANTED = {
  badAbn: [8, 21],
  missingName: [14],
  missingAbn: [5, 17],
  badEmail: [18],
  /** The same ABN under another spelling (row 31 repeats row 1), the same name with no ABN (row 32 repeats row 2). */
  duplicateInFile: [31, 32],
  /** A different spelling with no ABN: not the same by name or ABN, but it looks like row 3. */
  nameVariantInFile: [33],
};

export function supplierExtract(): SampleFile {
  const headers = ['Vendor Account', 'Name 1', 'ABN', 'City', 'Region', 'E-mail'];
  const rows: Cell[][] = [];
  const P = SUPPLIER_PLANTED;
  for (let n = 1; n <= 33; n++) {
    const sIdx = n <= 30 ? n - 1 : [0, 1, 2][n - 31]!;
    const s = SAMPLE_SUPPLIERS[sIdx]!;
    let name: Cell = s.name;
    let abn: Cell = ABN_OF(sIdx);
    let email: Cell = `accounts@${s.name
      .toLowerCase()
      .replace(/[^a-z]+/g, '')
      .slice(0, 14)}.example`;
    if (P.badAbn.includes(n)) abn = n === 8 ? breakAbn(ABN_OF(sIdx)) : ABN_OF(sIdx).slice(0, 9);
    if (P.missingName.includes(n)) name = '';
    if (P.missingAbn.includes(n)) abn = '';
    if (P.badEmail.includes(n)) email = 'accounts-at-example';
    if (n === 31) name = s.variants[0] ?? s.name;
    if (n === 32) abn = '';
    if (n === 33) {
      name = 'Cobalt IT Service Pty Ltd';
      abn = '';
    }
    rows.push([`V${String(100_000 + n * 13)}`, name, abn, s.city, s.state, email]);
  }
  return {
    key: 'supplier-extract',
    entity: 'SUPPLIERS',
    headers,
    rows,
    sourceSystem: 'SAP vendor extract',
    expected: { 'Name 1': 'company', ABN: 'abn', City: 'city', Region: 'state', 'E-mail': 'email' },
    planted: P,
  };
}

// ------------------------------------------------------------------ historical spend extract
export const SPEND_PLANTED = {
  badDate: [9, 140],
  futureDate: [33],
  badAmount: [51],
  zeroAmount: [77],
  missingSupplier: [88],
  duplicateInFile: [120],
  credit: [200],
};

export function spendExtract(): SampleFile {
  const r = rng(77_001);
  const headers = [
    'Posting Date',
    'Vendor',
    'Invoice No',
    'Amount (AUD)',
    'Category',
    'Department',
    'Cost Centre',
    'Description',
  ];
  const depts = ['Facilities', 'IT', 'Finance', 'Legal', 'Operations'];
  const rows: Cell[][] = [];
  const P = SPEND_PLANTED;
  for (let n = 1; n <= 300; n++) {
    const sIdx = Math.floor(r() * SAMPLE_SUPPLIERS.length);
    const s = SAMPLE_SUPPLIERS[sIdx]!;
    const y = 2022 + Math.floor(r() * 5);
    const m = 1 + Math.floor(r() * 12);
    const iso = isoOf(y, m, 1 + Math.floor(r() * 28));
    const when = iso > '2026-09-30' ? isoOf(2026, 9, 15) : iso;
    const amount = Math.round(500 + r() * 90_000);
    let dateCellV: Cell = dateCell(when, n);
    let amountCell: Cell = n % 3 === 0 ? `$${amount.toLocaleString('en-AU')}.00` : amount;
    let vendor: Cell = s.name;
    let inv: Cell = `INV-${String(20_000 + n)}`;
    if (P.badDate.includes(n)) dateCellV = n === 9 ? '2023-02-30' : 'last month';
    if (P.futureDate.includes(n)) dateCellV = '15/03/2027';
    if (P.badAmount.includes(n)) amountCell = 'see invoice';
    if (P.zeroAmount.includes(n)) amountCell = 0;
    if (P.missingSupplier.includes(n)) vendor = '';
    if (P.duplicateInFile.includes(n)) {
      const first = rows[18]!;
      dateCellV = first[0]!;
      amountCell = first[3]!;
      vendor = first[1]!;
      inv = first[2]!;
    }
    if (P.credit.includes(n)) amountCell = `(${amount.toLocaleString('en-AU')}.00)`;
    rows.push([
      dateCellV,
      vendor,
      inv,
      amountCell,
      s.category,
      depts[n % depts.length]!,
      `CC${1000 + (n % 12) * 10}`,
      `${s.category} - ${m}/${y}`,
    ]);
  }
  return {
    key: 'spend-extract',
    entity: 'SPEND',
    headers,
    rows,
    sourceSystem: 'Finance AP extract',
    expected: {
      'Posting Date': 'date',
      Vendor: 'supplier',
      'Invoice No': 'reference',
      'Amount (AUD)': 'amount',
      Category: 'category',
      Department: 'business_unit',
      'Cost Centre': 'cost_centre',
      Description: 'description',
    },
    planted: P,
  };
}

// ------------------------------------------------------------------ catalogue price list
export const CATALOGUE_PLANTED = {
  unknownSupplier: [6],
  badPrice: [11],
  duplicateInFile: [18],
  missingSku: [3],
};

export function cataloguePrices(): SampleFile {
  const headers = [
    'Supplier',
    'Item Code',
    'Item Description',
    'Unit Price',
    'UOM',
    'Category',
    'Lead Time (days)',
  ];
  const rows: Cell[][] = [];
  const P = CATALOGUE_PLANTED;
  const units = ['each', 'box', 'hour', 'month'];
  for (let n = 1; n <= 30; n++) {
    const sIdx = [9, 4, 16, 0, 12][n % 5]!;
    const s = SAMPLE_SUPPLIERS[sIdx]!;
    let supplier: Cell = s.name;
    let sku: Cell = `${s.name.slice(0, 3).toUpperCase()}-${String(100 + n)}`;
    let price: Cell = n % 2 ? Number((4 + n * 1.35).toFixed(2)) : `$${(4 + n * 1.35).toFixed(2)}`;
    if (P.unknownSupplier.includes(n)) supplier = 'Nonexistent Trading Pty Ltd';
    if (P.badPrice.includes(n)) price = 'POA';
    if (P.missingSku.includes(n)) sku = '';
    if (P.duplicateInFile.includes(n)) {
      supplier = rows[11]![0]!;
      sku = rows[11]![1]!;
    }
    rows.push([
      supplier,
      sku,
      `${s.category} item ${n}`,
      price,
      units[n % 4]!,
      s.category,
      n % 7 === 0 ? '' : String(2 + (n % 10)),
    ]);
  }
  return {
    key: 'catalogue-prices',
    entity: 'CATALOGUE',
    headers,
    rows,
    sourceSystem: 'Price list export',
    expected: {
      Supplier: 'supplier',
      'Item Code': 'sku',
      'Item Description': 'name',
      'Unit Price': 'unit_price',
      UOM: 'unit',
      Category: 'category',
      'Lead Time (days)': 'lead_days',
    },
    planted: P,
  };
}

// ------------------------------------------------------------------ output
export const SAMPLE_BUILDERS: Record<string, () => SampleFile> = {
  'legacy-contract-register': legacyContractRegister,
  'supplier-extract': supplierExtract,
  'spend-extract': spendExtract,
  'catalogue-prices': cataloguePrices,
};

const csvCell = (c: string) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** The sample as CSV (date cells are written dd/mm/yyyy, as a spreadsheet exports them). */
export function sampleCsv(s: Pick<SampleFile, 'headers' | 'rows'>): string {
  const text = (c: Cell) => (c === null ? '' : typeof c === 'object' ? dmy(c.date) : String(c));
  return (
    [s.headers, ...s.rows.map((r) => r.map(text))].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
  );
}
export const sampleXlsx = (s: Pick<SampleFile, 'headers' | 'rows' | 'key'>): Buffer =>
  buildWorkbook(s.key.slice(0, 31), [s.headers, ...s.rows]);

/** A template for an entity: the header row (field labels) and one example row, as CSV or xlsx. */
export function templateRows(entity: HistEntity): { headers: string[]; rows: Cell[][] } {
  const f = FIELDS[entity];
  const example: Record<HistEntity, Record<string, Cell>> = {
    CONTRACTS: {
      contract_number: 'AG-0001',
      title: 'Facilities cleaning',
      supplier: 'Apex Cleaning Pty Ltd',
      start_date: { date: '2022-07-01' },
      end_date: { date: '2025-06-30' },
      value: 240000,
      supplier_abn: sampleAbn(1),
      owner: 'Sofia Rossi',
      notice_months: 3,
      status: 'Active',
      currency: 'AUD',
      text: 'Either party may terminate on three months written notice.',
    },
    SUPPLIERS: {
      company: 'Apex Cleaning Pty Ltd',
      abn: sampleAbn(1),
      city: 'Brisbane',
      state: 'QLD',
      category: 'Facilities',
      email: 'accounts@apex.example',
    },
    SPEND: {
      supplier: 'Apex Cleaning Pty Ltd',
      amount: 12500,
      date: { date: '2025-03-14' },
      category: 'Facilities',
      business_unit: 'Operations',
      cost_centre: 'CC1010',
      reference: 'INV-20001',
      description: 'March cleaning',
      currency: 'AUD',
    },
    CATALOGUE: {
      supplier: 'Apex Cleaning Pty Ltd',
      sku: 'APX-100',
      name: 'Cleaning hour',
      unit_price: 48.5,
      category: 'Facilities',
      unit: 'hour',
      lead_days: 2,
      contract_number: 'AG-0001',
    },
  };
  return {
    headers: f.map((x) => x.label),
    rows: [f.map((x) => example[entity][x.key] ?? '')],
  };
}
