/**
 * The list of outbound paths shown on the residency page: every way data can leave the application, with the region it
 * lands in, the host it is called on, and whether the elected country and the egress allow-list let it through right now.
 */
import { eq } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { connector } from '../../db/schema.js';
import { MODELS } from '../b10ai/models.js';
import { CATALOGUE, providerEntry } from '../b10conn/catalogue.js';
import type { Settings } from '../settings/settings.js';
import { egressDecision } from './egress.js';
import { PURPOSES, purposeForKind, regionAllowed, type Purpose } from './region.js';

export interface OutboundPath {
  id: string;
  purpose: Purpose;
  purposeLabel: string;
  name: string;
  host: string | null;
  region: string;
  regionAllowed: boolean;
  egressAllowed: boolean;
  allowed: boolean;
  /** Whether the path is switched on for the tenant (a connector or the active AI model). */
  inUse: boolean;
  note: string | null;
}

export const SEARCH_TARGET = { name: 'Simulated web search', host: 'search.simulated.test', region: 'AU' };

export async function outboundPaths(tx: Tx, tenantId: string, s: Settings): Promise<OutboundPath[]> {
  const rows = await tx.select().from(connector).where(eq(connector.tenantId, tenantId));
  const out: OutboundPath[] = [];
  const add = (
    id: string,
    purpose: Purpose,
    name: string,
    host: string | null,
    region: string,
    inUse: boolean,
    note: string | null,
  ) => {
    const regionOk = regionAllowed(s.residency, region);
    const egressOk = host ? egressDecision(s.egress.allowedHosts, host).allowed : true;
    out.push({
      id,
      purpose,
      purposeLabel: PURPOSES[purpose],
      name,
      host,
      region,
      regionAllowed: regionOk,
      egressAllowed: egressOk,
      allowed: regionOk && egressOk,
      inUse,
      note,
    });
  };

  for (const k of CATALOGUE) {
    const row = rows.find((r) => r.kind === k.kind);
    if (!row || k.kind === 'AI') continue;
    const e = providerEntry(k.kind, row.provider);
    if (!e) continue;
    add(
      `connector:${k.kind}`,
      purposeForKind(k.kind),
      `${k.label}: ${e.label}`,
      e.host,
      e.region,
      row.enabled,
      null,
    );
  }
  for (const m of MODELS) {
    if (m.builtIn) continue;
    add(
      `model:${m.id}`,
      'AI_MODEL',
      m.label,
      m.endpointHost,
      m.dataHandling.region,
      s.ai.activeModel === m.id || Object.values(s.ai.taskOverrides ?? {}).includes(m.id),
      m.dataHandling.processedIn,
    );
  }
  add(
    'ai-conversations',
    'AI_CONVERSATION_STORE',
    'AI conversation transcripts',
    null,
    s.residency.aiRegion,
    true,
    'The AI region setting',
  );
  add(
    'search',
    'EXTERNAL_SEARCH',
    SEARCH_TARGET.name,
    SEARCH_TARGET.host,
    SEARCH_TARGET.region,
    s.externalSearch.enabled,
    'Only the words of the question go out',
  );
  add(
    'log-export',
    'LOG_EXPORT',
    'Log and audit export',
    null,
    s.residency.logRegion,
    true,
    'The log region setting',
  );
  return out;
}
