/**
 * The budget check with the imported ERP budget in front (NFR-C02, FR-0050, NFR-AV04).
 *
 * SWAP POINT (docs/swap-points.md): this wrapper sits in front of the existing `ErpBudgetService` (adapters/erp.ts). When a
 * business unit or cost centre has an imported budget line for the current financial year, that line (less posted actuals and
 * commitments) decides, and the result says where the figure came from. Otherwise the existing service answers exactly as before.
 * A real ERP would normally answer a live budget query through the same `ErpBudgetService` interface; the imported lines
 * then become the offline copy used when the live call fails.
 */
import type { BudgetCheckResult, ErpBudgetService, TenantBudgetConfig } from '../../adapters/erp.js';
import type { Tx } from '../../db/client.js';
import { providerEntry } from '../b10conn/catalogue.js';
import { getConnector } from '../b10conn/connectors.js';
import { erpBudgetFor, type BudgetSource } from './erp-sync.js';

export type BudgetCheckWithSource = BudgetCheckResult & { source: BudgetSource };

export async function checkBudget(
  tx: Tx,
  erp: ErpBudgetService,
  input: {
    tenantId: string;
    businessUnit: string;
    amount: number;
    settings?: TenantBudgetConfig;
    at: Date;
    costCentre?: string | null;
  },
): Promise<BudgetCheckWithSource> {
  const fallback = async (): Promise<BudgetCheckWithSource> => {
    const r = await erp.check({
      tenantId: input.tenantId,
      businessUnit: input.businessUnit,
      amount: input.amount,
      ...(input.settings ? { settings: input.settings } : {}),
    });
    return {
      ...r,
      source: {
        kind: 'TENANT_CONFIG',
        label: `Tenant budget settings for ${input.businessUnit} (no imported ERP budget for this unit)`,
      },
    };
  };
  // the outage switch in the tenant configuration still means "the finance system cannot answer"
  if (input.settings?.erpOutage) return fallback();
  const imported = await erpBudgetFor(tx, input.tenantId, input.businessUnit, input.at, input.costCentre);
  if (!imported) return fallback();
  const c = await getConnector(tx, input.tenantId, 'ERP');
  if (c && (c.mode === 'DOWN' || !c.enabled)) {
    const label = providerEntry('ERP', c.provider)?.label ?? c.provider;
    return {
      status: 'UNAVAILABLE',
      available: null,
      source: {
        kind: 'ERP_UNAVAILABLE',
        label: `${label} is not available; the imported budget (synced ${imported.source.syncedAt?.slice(0, 10) ?? 'never'}) is not used without a person confirming it`,
        ...(imported.source.provider ? { provider: imported.source.provider } : {}),
      },
    };
  }
  return {
    status: input.amount <= imported.available ? 'CLEARED' : 'EXCEEDED',
    available: imported.available,
    source: imported.source,
  };
}

/** One line for the conversation reply. Empty when the answer came from the tenant settings, so that reply is unchanged. */
export const sourceLine = (s: BudgetSource): string =>
  s.kind === 'TENANT_CONFIG' ? '' : `Source: ${s.label}.`;
