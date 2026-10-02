/**
 * SWAP POINT: finance / ERP budget check (FR-0050, NFR-AV04). Mock reads per-business-unit available budgets from the
 * tenant configuration. An outage is simulated with `erpOutage: true`; callers must then fall back to a manual path.
 */
export type BudgetStatus = 'CLEARED' | 'EXCEEDED' | 'UNAVAILABLE';

export interface BudgetCheckResult {
  status: BudgetStatus;
  available: number | null;
}
export interface ErpBudgetService {
  check(input: {
    tenantId: string;
    businessUnit: string;
    amount: number;
    /** Mock-only hint: budgets and outage switch, read by the caller inside its own transaction. A real adapter ignores it. */
    settings?: TenantBudgetConfig;
  }): Promise<BudgetCheckResult>;
}

export interface TenantBudgetConfig {
  budgets?: Record<string, number>;
  erpOutage?: boolean;
}

/**
 * Deterministic stand-in. It deliberately does NOT query the database itself: it runs inside the caller's
 * transaction, and a second query on the same connection would wait forever for that transaction (single-connection
 * PGlite) - so the caller passes the tenant settings in.
 */
export class MockErpBudgetService implements ErpBudgetService {
  async check({
    businessUnit,
    amount,
    settings,
  }: {
    tenantId: string;
    businessUnit: string;
    amount: number;
    settings?: TenantBudgetConfig;
  }): Promise<BudgetCheckResult> {
    const cfg = settings ?? {};
    if (cfg.erpOutage) return { status: 'UNAVAILABLE', available: null };
    const available = cfg.budgets?.[businessUnit];
    if (available === undefined) return { status: 'UNAVAILABLE', available: null }; // unknown unit: cannot clear automatically
    return { status: amount <= available ? 'CLEARED' : 'EXCEEDED', available };
  }
}
