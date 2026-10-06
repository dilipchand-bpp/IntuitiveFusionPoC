/**
 * Simulated ERP sources and the three mappers (NFR-C02).
 *
 * SWAP POINT (docs/swap-points.md): `fetchErpSource(provider, revision)` is the only function that stands in for the ERP.
 * A real adapter calls the customer's system (SAP S/4HANA OData / CDS views, Oracle Fusion REST, Dynamics 365 Finance data
 * entities) and returns that system's native payload, unchanged. Everything after that, the mappers in this file and the
 * importer in erp-sync.ts, stays the same. The three providers deliberately use different field names, nesting, date formats
 * and money formats (SAP: YYYYMMDD and "1,200,000.00" strings; Oracle: ISO dates and amounts in minor units; Dynamics: OData
 * collections and ISO timestamps), because a mapper that normalises those differences is the point of the requirement.
 *
 * The data is synthetic: one canonical dataset is generated deterministically for a revision (1 to 3), then rendered into the
 * provider's native shape. Revision 2 changes some budgets and names, removes a cost centre and adds one; revision 3 restores
 * and suspends others, so a second import can be shown to change only what changed.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '../b10conn/signing.js';

export const ERP_PROVIDERS = ['SAP', 'ORACLE', 'DYNAMICS'] as const;
export type ErpProvider = (typeof ERP_PROVIDERS)[number];
export const isErpProvider = (v: string): v is ErpProvider =>
  (ERP_PROVIDERS as readonly string[]).includes(v);
export const MAX_REVISION = 3;

/** Australian financial year (1 July to 30 June), named for the year it ends in: 2026-10-06 is FY2027. */
export const financialYearOf = (isoDate: string): string => {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return `FY${m >= 7 ? y + 1 : y}`;
};

// ---------------------------------------------------------------- the normalised shape every mapper produces
export interface NormOrgUnit {
  externalId: string;
  code: string;
  name: string;
  parentExternalId: string | null;
  active: boolean;
}
export interface NormCostCentre {
  externalId: string;
  code: string;
  name: string;
  orgUnitExternalId: string | null;
  ownerName: string | null;
  active: boolean;
}
export interface NormBudget {
  externalId: string;
  costCentreExternalId: string;
  financialYear: string;
  category: string;
  amount: number;
  currency: string;
}
export interface NormLedger {
  externalId: string;
  costCentreExternalId: string;
  postingDate: string;
  financialYear: string;
  account: string;
  description: string;
  amount: number;
  kind: 'ACTUAL' | 'COMMITMENT';
  currency: string;
}
export interface Normalised {
  orgUnits: NormOrgUnit[];
  costCentres: NormCostCentre[];
  budgets: NormBudget[];
  ledger: NormLedger[];
}

export const hashOf = (v: unknown): string =>
  createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 32);

// ---------------------------------------------------------------- the canonical synthetic dataset
interface COrg {
  key: string;
  name: string;
  parent: string | null;
  active: boolean;
}
interface CCentre {
  code: string;
  name: string;
  org: string;
  owner: string;
  active: boolean;
}
interface CBudget {
  id: string;
  cc: string;
  fy: number;
  category: 'OPEX' | 'CAPEX';
  cents: number;
}
interface CLedger {
  id: string;
  cc: string;
  date: string;
  account: string;
  text: string;
  cents: number;
  kind: 'ACTUAL' | 'COMMITMENT';
}
interface Canonical {
  orgs: COrg[];
  centres: CCentre[];
  budgets: CBudget[];
  ledger: CLedger[];
}

const ORGS: Array<[string, string]> = [
  ['FAC', 'Facilities'],
  ['IT', 'IT'],
  ['PRC', 'Procurement'],
  ['FIN', 'Finance'],
  ['LEG', 'Legal'],
  ['RSK', 'Risk'],
  ['EXE', 'Executive'],
  ['OPS', 'Operations'],
];
const CENTRES: Array<[string, string, string, string, number]> = [
  ['FAC-100', 'Facilities Operations', 'FAC', 'Sofia Rossi', 1_200_000],
  ['FAC-200', 'Facilities Projects', 'FAC', 'Sofia Rossi', 600_000],
  ['IT-100', 'IT Infrastructure', 'IT', 'Tomas Silva', 3_000_000],
  ['IT-200', 'IT Applications', 'IT', 'Tomas Silva', 2_500_000],
  ['PRC-100', 'Procurement Office', 'PRC', 'Priya Nair', 400_000],
  ['FIN-100', 'Finance Operations', 'FIN', 'Aisha Rahman', 250_000],
  ['LEG-100', 'Legal Services', 'LEG', 'Henry Albright', 350_000],
  ['RSK-100', 'Risk and Assurance', 'RSK', 'Jonas Becker', 200_000],
  ['EXE-100', 'Executive Office', 'EXE', 'Elena Petrova', 900_000],
  ['OPS-100', 'Operations Delivery', 'OPS', 'Riley Chen', 1_800_000],
  ['OPS-200', 'Field Services', 'OPS', 'Riley Chen', 900_000],
];
const ACCOUNTS = [
  ['6100', 'Contractors'],
  ['6200', 'Software and licences'],
  ['6300', 'Facilities and utilities'],
] as const;

/** The synthetic ERP at a revision. Deterministic: the same revision always gives the same data. */
export function canonicalDataset(revision: number): Canonical {
  const rev = Math.min(MAX_REVISION, Math.max(1, Math.floor(revision) || 1));
  const orgs: COrg[] = [
    { key: 'MER', name: 'Meridian Group', parent: null, active: true },
    ...ORGS.map(([key, name]) => ({ key, name, parent: 'MER', active: true })),
  ];
  let centres: CCentre[] = CENTRES.map(([code, name, org, owner]) => ({
    code,
    name,
    org,
    owner,
    active: true,
  }));
  const budgetOf = new Map(CENTRES.map(([code, , , , amount]) => [code, amount * 100]));
  const budgets: CBudget[] = [];
  const addBudgets = (code: string) => {
    const cents = budgetOf.get(code)!;
    budgets.push({
      id: `B-${code}-2026-OPEX`,
      cc: code,
      fy: 2026,
      category: 'OPEX',
      cents: Math.round(cents * 0.9),
    });
    budgets.push({ id: `B-${code}-2027-OPEX`, cc: code, fy: 2027, category: 'OPEX', cents });
  };
  for (const [code] of CENTRES) addBudgets(code);
  budgets.push({ id: 'B-IT-100-2027-CAPEX', cc: 'IT-100', fy: 2027, category: 'CAPEX', cents: 50_000_000 });

  const ledger: CLedger[] = [];
  const addLedger = (code: string) => {
    const cents = budgetOf.get(code)!;
    [0.04, 0.05, 0.045].forEach((share, i) => {
      const acct = ACCOUNTS[i]!;
      ledger.push({
        id: `L-${code}-2026-${i + 1}`,
        cc: code,
        date: ['2026-07-31', '2026-08-31', '2026-09-30'][i]!,
        account: acct[0],
        text: acct[1],
        cents: Math.round(cents * share),
        kind: 'ACTUAL',
      });
    });
    ledger.push({
      id: `L-${code}-2026-C1`,
      cc: code,
      date: '2026-10-01',
      account: '6100',
      text: 'Open purchase commitments',
      cents: Math.round(cents * 0.02),
      kind: 'COMMITMENT',
    });
  };
  for (const [code] of CENTRES) addLedger(code);

  if (rev >= 2) {
    // a budget goes up, a name changes, a cost centre goes away and another arrives, and one new posting lands
    const b = budgets.find((x) => x.id === 'B-FAC-100-2027-OPEX')!;
    b.cents = 135_000_000;
    centres = centres.filter((c) => c.code !== 'OPS-200');
    for (let i = budgets.length - 1; i >= 0; i -= 1) if (budgets[i]!.cc === 'OPS-200') budgets.splice(i, 1);
    for (let i = ledger.length - 1; i >= 0; i -= 1) if (ledger[i]!.cc === 'OPS-200') ledger.splice(i, 1);
    centres.find((c) => c.code === 'PRC-100')!.name = 'Procurement and Contracts Office';
    centres.push({
      code: 'FAC-300',
      name: 'Facilities Energy',
      org: 'FAC',
      owner: 'Sofia Rossi',
      active: true,
    });
    budgetOf.set('FAC-300', 25_000_000);
    addBudgets('FAC-300');
    addLedger('FAC-300');
    ledger.push({
      id: 'L-IT-100-2026-4',
      cc: 'IT-100',
      date: '2026-10-02',
      account: '6200',
      text: 'Cloud hosting October',
      cents: 18_500_000,
      kind: 'ACTUAL',
    });
  }
  if (rev >= 3) {
    // the removed cost centre comes back, and finance operations is suspended
    centres.push({ code: 'OPS-200', name: 'Field Services', org: 'OPS', owner: 'Riley Chen', active: true });
    addBudgets('OPS-200');
    addLedger('OPS-200');
    centres.find((c) => c.code === 'FIN-100')!.active = false;
  }
  return { orgs, centres, budgets, ledger };
}

// ---------------------------------------------------------------- small formatting helpers per provider
const ymdCompact = (iso: string) => iso.replace(/-/g, '');
const sapMoney = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sapKostl = (code: string) => code.replace('-', '').toUpperCase().padStart(10, '0');
const oracleId = (list: readonly string[], key: string) => 300_001 + list.indexOf(key);

// ---------------------------------------------------------------- native payloads
/** Native shapes are opaque outside this file: the importer only ever passes them to the matching mapper. */
export type NativePayload = Record<string, unknown>;

function renderSap(c: Canonical): NativePayload {
  return {
    system: 'S4HANA',
    KOKRS: 'MER1',
    ORG_UNITS: c.orgs.map((o) => ({
      ORGEH: o.key,
      ORGTX: o.name,
      PUP_ORGEH: o.parent ?? '',
      DELFG: o.active ? '' : 'X',
    })),
    COST_CENTERS: c.centres.map((k) => ({
      KOSTL: sapKostl(k.code),
      KTEXT: k.name,
      ABTEI: k.org,
      VERAK: k.owner,
      LOCK_ALL: k.active ? '' : 'X',
    })),
    BUDGET: c.budgets.map((b) => ({
      DOCNR: b.id,
      GJAHR: String(b.fy),
      KOSTL: sapKostl(b.cc),
      WRTTP: b.category,
      WTGES: sapMoney(b.cents),
      WAERS: 'AUD',
    })),
    LEDGER: c.ledger.map((l) => ({
      BELNR: l.id,
      BUDAT: ymdCompact(l.date),
      KOSTL: sapKostl(l.cc),
      HKONT: l.account,
      SGTXT: l.text,
      WRBTR: sapMoney(l.cents),
      WAERS: 'AUD',
      VRGNG: l.kind === 'ACTUAL' ? 'RFBU' : 'RMPR',
    })),
  };
}

function renderOracle(c: Canonical): NativePayload {
  const orgKeys = c.orgs.map((o) => o.key);
  // an id never moves when another cost centre is removed: derive it from the full list of codes, not the current one
  const allCodes = CENTRES.map(([code]) => code).concat(['FAC-300']);
  const ccId = (code: string) => 400_001 + allCodes.indexOf(code);
  return {
    source: 'ORACLE_FUSION',
    organizations: {
      items: c.orgs.map((o) => ({
        OrganizationId: oracleId(orgKeys, o.key),
        OrganizationName: o.name,
        ParentOrganizationId: o.parent ? oracleId(orgKeys, o.parent) : null,
        EnabledFlag: o.active,
      })),
    },
    costCenters: {
      items: c.centres.map((k) => ({
        CostCenterId: ccId(k.code),
        CostCenterCode: k.code,
        CostCenterName: k.name,
        OrganizationId: oracleId(orgKeys, k.org),
        ManagerName: k.owner,
        EnabledFlag: k.active,
      })),
    },
    budgets: {
      items: c.budgets.map((b) => ({
        BudgetLineId: 700_000 + hashNumber(b.id),
        CostCenterId: ccId(b.cc),
        FiscalYear: `FY${String(b.fy).slice(2)}`,
        BudgetCategory: b.category,
        BudgetAmountMinor: b.cents,
        CurrencyCode: 'AUD',
      })),
    },
    journals: {
      items: c.ledger.map((l) => ({
        JournalLineId: 900_000 + hashNumber(l.id),
        CostCenterId: ccId(l.cc),
        AccountingDate: l.date,
        AccountCode: l.account,
        Description: l.text,
        EnteredDr: l.cents,
        EnteredCr: 0,
        CurrencyCode: 'AUD',
        JournalType: l.kind === 'ACTUAL' ? 'ACTUAL' : 'ENCUMBRANCE',
      })),
    },
  };
}

function renderDynamics(c: Canonical): NativePayload {
  return {
    '@odata.context': 'https://erp.example.invalid/data/$metadata',
    DimensionHierarchy: {
      value: c.orgs.map((o) => ({
        Name: o.key,
        Description: o.name,
        ParentName: o.parent,
        IsSuspended: !o.active,
      })),
    },
    LedgerDimensionValues: {
      value: c.centres.map((k) => ({
        DimensionValue: k.code,
        Description: k.name,
        ParentOrganization: k.org,
        Responsible: k.owner,
        IsSuspended: !k.active,
      })),
    },
    BudgetRegisterEntries: {
      value: c.budgets.map((b) => ({
        BudgetRegisterEntryId: b.id,
        DimensionValue: b.cc,
        FiscalYearName: `FY${b.fy}`,
        BudgetCode: b.category,
        Amount: b.cents / 100,
        TransactionCurrencyCode: 'AUD',
      })),
    },
    GeneralJournalAccountEntries: {
      value: c.ledger.map((l) => ({
        RecordId: l.id,
        DimensionValue: l.cc,
        AccountingDate: `${l.date}T00:00:00Z`,
        MainAccount: l.account,
        Text: l.text,
        TransactionCurrencyAmount: l.cents / 100,
        TransactionCurrencyCode: 'AUD',
        PostingLayer: l.kind === 'ACTUAL' ? 'Current' : 'Encumbrance',
      })),
    },
  };
}

function hashNumber(s: string): number {
  return parseInt(createHash('sha256').update(s).digest('hex').slice(0, 6), 16);
}

/** The simulated ERP: what the provider's system would return today, in its own shape. */
export async function fetchErpSource(provider: ErpProvider, revision: number): Promise<NativePayload> {
  const data = canonicalDataset(revision);
  return provider === 'SAP'
    ? renderSap(data)
    : provider === 'ORACLE'
      ? renderOracle(data)
      : renderDynamics(data);
}

// ---------------------------------------------------------------- the three mappers: native payload -> normalised
const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v : []) as never;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => Number(v);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** SAP: German-abbreviated fields, dates as YYYYMMDD, money as formatted strings, a lock flag and a deletion flag. */
export function mapSap(p: NativePayload): Normalised {
  const ymd = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const money = (s: unknown) => r2(Number(str(s).replace(/,/g, '')));
  const orgs = arr(p.ORG_UNITS).map((o) => ({
    externalId: str(o.ORGEH),
    code: str(o.ORGEH),
    name: str(o.ORGTX),
    parentExternalId: str(o.PUP_ORGEH) || null,
    active: str(o.DELFG) !== 'X',
  }));
  const centres = arr(p.COST_CENTERS).map((k) => ({
    externalId: str(k.KOSTL),
    code: str(k.KOSTL)
      .replace(/^0+/, '')
      .replace(/^([A-Z]+)(\d+)$/, '$1-$2'),
    name: str(k.KTEXT),
    orgUnitExternalId: str(k.ABTEI) || null,
    ownerName: str(k.VERAK) || null,
    active: str(k.LOCK_ALL) !== 'X',
  }));
  const budgets = arr(p.BUDGET).map((b) => ({
    externalId: str(b.DOCNR),
    costCentreExternalId: str(b.KOSTL),
    financialYear: `FY${str(b.GJAHR)}`,
    category: str(b.WRTTP),
    amount: money(b.WTGES),
    currency: str(b.WAERS) || 'AUD',
  }));
  const ledger = arr(p.LEDGER).map((l) => {
    const date = ymd(str(l.BUDAT));
    return {
      externalId: str(l.BELNR),
      costCentreExternalId: str(l.KOSTL),
      postingDate: date,
      financialYear: financialYearOf(date),
      account: str(l.HKONT),
      description: str(l.SGTXT),
      amount: money(l.WRBTR),
      kind: str(l.VRGNG) === 'RFBU' ? ('ACTUAL' as const) : ('COMMITMENT' as const),
      currency: str(l.WAERS) || 'AUD',
    };
  });
  return { orgUnits: orgs, costCentres: centres, budgets, ledger };
}

/** Oracle: REST collections under `items`, numeric ids, money in minor units, debit and credit columns. */
export function mapOracle(p: NativePayload): Normalised {
  const items = (k: string) => arr((p[k] as { items?: unknown } | undefined)?.items);
  const orgs = items('organizations').map((o) => ({
    externalId: str(o.OrganizationId),
    code: str(o.OrganizationName)
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 4),
    name: str(o.OrganizationName),
    parentExternalId: o.ParentOrganizationId === null ? null : str(o.ParentOrganizationId),
    active: o.EnabledFlag !== false,
  }));
  const centres = items('costCenters').map((k) => ({
    externalId: str(k.CostCenterId),
    code: str(k.CostCenterCode),
    name: str(k.CostCenterName),
    orgUnitExternalId: str(k.OrganizationId) || null,
    ownerName: str(k.ManagerName) || null,
    active: k.EnabledFlag !== false,
  }));
  const budgets = items('budgets').map((b) => ({
    externalId: str(b.BudgetLineId),
    costCentreExternalId: str(b.CostCenterId),
    financialYear: `FY20${str(b.FiscalYear).replace(/^FY/, '')}`,
    category: str(b.BudgetCategory),
    amount: r2(num(b.BudgetAmountMinor) / 100),
    currency: str(b.CurrencyCode) || 'AUD',
  }));
  const ledger = items('journals').map((l) => {
    const date = str(l.AccountingDate).slice(0, 10);
    return {
      externalId: str(l.JournalLineId),
      costCentreExternalId: str(l.CostCenterId),
      postingDate: date,
      financialYear: financialYearOf(date),
      account: str(l.AccountCode),
      description: str(l.Description),
      amount: r2((num(l.EnteredDr) - num(l.EnteredCr)) / 100),
      kind: str(l.JournalType) === 'ACTUAL' ? ('ACTUAL' as const) : ('COMMITMENT' as const),
      currency: str(l.CurrencyCode) || 'AUD',
    };
  });
  return { orgUnits: orgs, costCentres: centres, budgets, ledger };
}

/** Dynamics 365 Finance: OData `value` collections, dimension values as keys, suspension flags, ISO timestamps. */
export function mapDynamics(p: NativePayload): Normalised {
  const val = (k: string) => arr((p[k] as { value?: unknown } | undefined)?.value);
  const orgs = val('DimensionHierarchy').map((o) => ({
    externalId: str(o.Name),
    code: str(o.Name),
    name: str(o.Description),
    parentExternalId: o.ParentName === null || o.ParentName === undefined ? null : str(o.ParentName),
    active: o.IsSuspended !== true,
  }));
  const centres = val('LedgerDimensionValues').map((k) => ({
    externalId: str(k.DimensionValue),
    code: str(k.DimensionValue),
    name: str(k.Description),
    orgUnitExternalId: str(k.ParentOrganization) || null,
    ownerName: str(k.Responsible) || null,
    active: k.IsSuspended !== true,
  }));
  const budgets = val('BudgetRegisterEntries').map((b) => ({
    externalId: str(b.BudgetRegisterEntryId),
    costCentreExternalId: str(b.DimensionValue),
    financialYear: str(b.FiscalYearName),
    category: str(b.BudgetCode),
    amount: r2(num(b.Amount)),
    currency: str(b.TransactionCurrencyCode) || 'AUD',
  }));
  const ledger = val('GeneralJournalAccountEntries').map((l) => {
    const date = str(l.AccountingDate).slice(0, 10);
    return {
      externalId: str(l.RecordId),
      costCentreExternalId: str(l.DimensionValue),
      postingDate: date,
      financialYear: financialYearOf(date),
      account: str(l.MainAccount),
      description: str(l.Text),
      amount: r2(num(l.TransactionCurrencyAmount)),
      kind: str(l.PostingLayer) === 'Current' ? ('ACTUAL' as const) : ('COMMITMENT' as const),
      currency: str(l.TransactionCurrencyCode) || 'AUD',
    };
  });
  return { orgUnits: orgs, costCentres: centres, budgets, ledger };
}

export function mapErp(provider: ErpProvider, payload: NativePayload): Normalised {
  return provider === 'SAP'
    ? mapSap(payload)
    : provider === 'ORACLE'
      ? mapOracle(payload)
      : mapDynamics(payload);
}

/** What the mapper must hand the importer is checked once more here, so a bad payload fails loudly instead of importing nonsense. */
export function validateNormalised(n: Normalised): string[] {
  const problems: string[] = [];
  const dupes = (name: string, ids: string[]) => {
    if (new Set(ids).size !== ids.length) problems.push(`${name} has a repeated external id`);
  };
  dupes(
    'cost centres',
    n.costCentres.map((x) => x.externalId),
  );
  dupes(
    'organisation units',
    n.orgUnits.map((x) => x.externalId),
  );
  dupes(
    'budget lines',
    n.budgets.map((x) => x.externalId),
  );
  dupes(
    'ledger postings',
    n.ledger.map((x) => x.externalId),
  );
  for (const b of n.budgets)
    if (!Number.isFinite(b.amount) || b.amount < 0)
      problems.push(`budget ${b.externalId} has no valid amount`);
  for (const l of n.ledger)
    if (!Number.isFinite(l.amount) || !/^\d{4}-\d{2}-\d{2}$/.test(l.postingDate))
      problems.push(`ledger posting ${l.externalId} has no valid amount or date`);
  return problems;
}
