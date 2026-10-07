/**
 * Search across the organisation's own records and, when the organisation has allowed it, an outside AI source (FR-0880).
 * The records are searched first, under the same visibility rules as everywhere else. The outside source is asked only with
 * the words of the question: reference numbers, ABNs, email addresses and the names of suppliers are taken out before anything
 * leaves, what was withheld is listed, and every outbound question is logged.
 *
 * SWAP POINT (docs/swap-points.md): `SimulatedExternalSearch` returns results from a small, clearly synthetic corpus. A real
 * adapter calls an approved provider through the organisation's gateway and returns the same shape.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditService } from '../../audit/audit-service.js';
import { guard, type GuardDeps } from '../../auth/guard.js';
import { withContext } from '../../db/client.js';
import { catalogueItem, contract, externalSearchLog, lesson, supplier } from '../../db/schema.js';
import { parse } from '../../http/errors.js';
import { visibleRequests } from '../reporting/scope.js';
import { loadSettings } from '../settings/settings.js';
import { tokensOf } from './buying.js';
import { flagContent, neutralise } from '../b11priv/content-safety.js';
import { assertOutbound, refusable } from '../b11priv/outbound.js';

export const SEARCH_MODEL = 'rules-simulated-v1';

export interface ExternalHit {
  title: string;
  snippet: string;
  source: string;
}
export interface ExternalSearch {
  readonly name: string;
  readonly simulated: boolean;
  /** Where the provider processes the question (SEC-D09) and the host it is called on (SEC-D05). Defaults: AU and a simulated host. */
  readonly region?: string;
  readonly host?: string;
  search(query: string): Promise<ExternalHit[]>;
}

const CORPUS: Array<ExternalHit & { tags: string[] }> = [
  {
    title: 'Commercial cleaning: what drives the price',
    snippet:
      'Illustrative benchmark (synthetic): labour is about 80% of the cost of commercial cleaning, so rate cards by hour and a clear specification of frequency matter more than the headline price.',
    source: 'example-market-data.test/cleaning',
    tags: ['cleaning', 'facilities', 'hour'],
  },
  {
    title: 'Security guarding: award on the full cost',
    snippet:
      'Illustrative benchmark (synthetic): comparisons of guarding tenders should include award wages, on-costs, supervision and patrol technology, not the hourly rate alone.',
    source: 'example-market-data.test/security',
    tags: ['security', 'guard', 'guarding'],
  },
  {
    title: 'Managed IT services: contract terms to expect',
    snippet:
      'Illustrative benchmark (synthetic): service levels with credits, a 90-day exit assistance clause and data return on termination are now standard in managed IT agreements.',
    source: 'example-market-data.test/it',
    tags: ['managed', 'service', 'desk', 'software', 'cloud'],
  },
  {
    title: 'Software licences: counting users',
    snippet:
      'Illustrative benchmark (synthetic): licence counts drift. Ask for an annual true-up with a cap, and for the right to reduce seats at renewal.',
    source: 'example-market-data.test/licences',
    tags: ['licence', 'licences', 'subscription', 'software', 'saas', 'seats'],
  },
  {
    title: 'Legal panel arrangements',
    snippet:
      'Illustrative benchmark (synthetic): panel arrangements usually fix rates by seniority, require conflict checks at each engagement and report spend by matter.',
    source: 'example-market-data.test/legal',
    tags: ['legal', 'panel', 'counsel', 'law'],
  },
  {
    title: 'Catering and events: lead times',
    snippet:
      'Illustrative benchmark (synthetic): allow 10 working days for events over 100 people, and put dietary and allergen handling in the specification.',
    source: 'example-market-data.test/catering',
    tags: ['catering', 'events', 'food'],
  },
  {
    title: 'Uniforms and workwear',
    snippet:
      'Illustrative benchmark (synthetic): price by garment and by wash cycle; ask for ethical sourcing evidence under modern slavery reporting.',
    source: 'example-market-data.test/uniforms',
    tags: ['uniform', 'uniforms', 'workwear', 'garment'],
  },
  {
    title: 'Grounds maintenance and landscaping',
    snippet:
      'Illustrative benchmark (synthetic): seasonal schedules cost less than flat monthly fees where growth is seasonal; separate capital works from maintenance.',
    source: 'example-market-data.test/grounds',
    tags: ['landscaping', 'grounds', 'garden', 'maintenance'],
  },
  {
    title: 'Office supplies and paper',
    snippet:
      'Illustrative benchmark (synthetic): consolidate on a catalogue with a delivery minimum, and compare recycled content and price per thousand sheets.',
    source: 'example-market-data.test/paper',
    tags: ['paper', 'stationery', 'office', 'supplies'],
  },
  {
    title: 'Supplier insurance requirements',
    snippet:
      'Illustrative benchmark (synthetic): public liability is commonly required at 10 to 20 million for services on site, with professional indemnity matched to the risk of the work.',
    source: 'example-market-data.test/insurance',
    tags: ['insurance', 'liability', 'indemnity', 'cover'],
  },
];

export class SimulatedExternalSearch implements ExternalSearch {
  readonly name = 'Simulated web search';
  readonly simulated = true;
  readonly region = 'AU';
  readonly host = 'search.simulated.test';
  async search(query: string): Promise<ExternalHit[]> {
    const t = tokensOf(query);
    return CORPUS.map((c) => ({
      c,
      n: t.filter((w) => c.tags.includes(w) || c.title.toLowerCase().includes(w)).length,
    }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 4)
      .map(({ c }) => ({ title: c.title, snippet: c.snippet, source: c.source }));
  }
}

/** What may leave: the question's words only. Returns the cleaned question and what was taken out of it. */
export function sanitise(query: string, supplierNames: string[]): { sent: string; withheld: string[] } {
  const withheld: string[] = [];
  let q = query;
  const take = (re: RegExp, label: string) => {
    q = q.replace(re, (m) => {
      withheld.push(`${label}: ${m}`);
      return '[withheld]';
    });
  };
  take(/\b[A-Z]{2,4}-(?:[A-Z]{2}-)?(?:\d{2,4}-)?\d{2,6}\b/g, 'reference');
  take(/\b\d{2}\s?\d{3}\s?\d{3}\s?\d{3}\b/g, 'ABN');
  take(/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'email');
  take(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|million)?/gi, 'amount');
  for (const n of [...supplierNames].sort((a, b) => b.length - a.length)) {
    const core = n.replace(/\s+(pty\.?\s*)?(ltd\.?|limited)$/i, '').trim();
    if (core.length < 4) continue;
    const re = new RegExp(core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    take(re, 'supplier name');
  }
  return { sent: q.replace(/\s+/g, ' ').trim(), withheld };
}

const searchBody = z
  .object({ query: z.string().trim().min(3).max(200), includeExternal: z.boolean().default(false) })
  .strict();
const STAFF = [
  'REQUESTER',
  'PROCUREMENT',
  'DELEGATE',
  'EVALUATOR',
  'CHAIR',
  'LEGAL',
  'CONTRACT_MGR',
  'PROBITY',
  'FINANCE',
  'EXEC',
] as const;

export interface SearchDeps extends GuardDeps {
  audit: AuditService;
  external?: ExternalSearch;
}
interface Group {
  kind: 'REQUEST' | 'CONTRACT' | 'SUPPLIER' | 'LESSON' | 'CATALOGUE';
  label: string;
  total: number;
  items: Array<{ id: string; title: string; subtitle: string; link: string | null }>;
}

export function registerSearch(app: FastifyInstance, p: string, d: SearchDeps): Set<string> {
  const done = new Set<string>();
  const reg = (m: string, path: string) => done.add(`${m} ${path}`);
  const provider = d.external ?? new SimulatedExternalSearch();

  reg('POST', '/search');
  app.post(
    `${p}/search`,
    { preHandler: guard(d, [...STAFF]), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const a = req.auth!;
      const b = parse(searchBody, req.body);
      const roles = a.user.roles;
      const words = tokensOf(b.query);
      return refusable(d.database, a.ctx, async (tx) => {
        const s = await loadSettings(tx, a.user.tenantId);
        const hit = (...fields: Array<string | null | undefined>) => {
          const h = fields.join(' ').toLowerCase();
          return (
            words.length > 0 &&
            words.every((w) => h.includes(w) || (w.endsWith('s') && h.includes(w.slice(0, -1))))
          );
        };
        const groups: Group[] = [];
        const push = (kind: Group['kind'], label: string, items: Group['items']) =>
          items.length && groups.push({ kind, label, total: items.length, items: items.slice(0, 5) });

        // the person's own view of the procurements: the same rule as the reports
        const reqs = (await visibleRequests(tx, a)).rows.filter((r) =>
          hit(r.number, r.title, r.category, r.businessUnit),
        );
        push(
          'REQUEST',
          'Procurements',
          reqs.map((r) => ({
            id: r.id,
            title: r.title,
            subtitle: `${r.number} · ${r.phase.toLowerCase().replace('_', ' ')}`,
            link: `/app/requests/${r.id}`,
          })),
        );

        const portfolio = roles.some((r) =>
          ['PROCUREMENT', 'LEGAL', 'EXEC', 'FINANCE', 'PROBITY', 'DELEGATE'].includes(r),
        );
        if (portfolio || roles.includes('CONTRACT_MGR')) {
          const cs = await tx
            .select({ c: contract, s: supplier.company })
            .from(contract)
            .innerJoin(supplier, eq(supplier.id, contract.supplierId))
            .where(
              and(
                eq(contract.tenantId, a.user.tenantId),
                isNull(contract.deletedAt),
                isNull(contract.parentId),
                portfolio ? undefined : eq(contract.ownerId, a.user.id),
              ),
            );
          push(
            'CONTRACT',
            'Contracts',
            cs
              .filter((x) => hit(x.c.number, x.c.title, x.s))
              .map((x) => ({
                id: x.c.id,
                title: x.c.title ?? x.c.number,
                subtitle: `${x.c.number} · ${x.s}`,
                link: `/app/contracts/${x.c.id}`,
              })),
          );
        }
        if (roles.some((r) => ['PROCUREMENT', 'LEGAL', 'FINANCE'].includes(r))) {
          const sups = await tx.select().from(supplier).where(eq(supplier.tenantId, a.user.tenantId));
          push(
            'SUPPLIER',
            'Suppliers',
            sups
              .filter((x) => hit(x.company, x.abn, ((x.categories as string[]) ?? []).join(' ')))
              .map((x) => ({
                id: x.id,
                title: x.company,
                subtitle: `ABN ${x.abn}`,
                link: `/app/suppliers/${x.id}`,
              })),
          );
        }
        const les = await tx
          .select()
          .from(lesson)
          .where(eq(lesson.tenantId, a.user.tenantId))
          .orderBy(desc(lesson.createdAt))
          .limit(200);
        const visibleIds = new Set((await visibleRequests(tx, a)).rows.map((r) => r.id));
        push(
          'LESSON',
          'Lessons learned',
          les
            .filter((l) => hit(l.text, l.category))
            .map((l) => ({
              id: l.id,
              title: l.text.slice(0, 120),
              subtitle: l.category ?? 'Lesson',
              link: visibleIds.has(l.requestId) ? `/app/requests/${l.requestId}` : null,
            })),
        );
        const cat = await tx
          .select()
          .from(catalogueItem)
          .where(and(eq(catalogueItem.tenantId, a.user.tenantId), eq(catalogueItem.active, true)));
        push(
          'CATALOGUE',
          'Catalogue items',
          cat
            .filter((c) => hit(c.name, c.category, c.sku))
            .map((c) => ({
              id: c.id,
              title: c.name,
              subtitle: `${c.category} · ${c.unit}`,
              link: '/app/buy',
            })),
        );

        let external: {
          enabled: boolean;
          asked: boolean;
          provider: string;
          sent: string | null;
          withheld: string[];
          hits: ExternalHit[];
          simulated: boolean;
          note: string | null;
        } = {
          enabled: s.externalSearch.enabled,
          asked: false,
          provider: provider.name,
          sent: null,
          withheld: [],
          hits: [],
          simulated: provider.simulated,
          note: null,
        };
        if (b.includeExternal) {
          if (!s.externalSearch.enabled)
            external.note =
              'Outside search is switched off for this organisation. Only your own records were searched.';
          else {
            const names = (
              await tx
                .select({ c: supplier.company })
                .from(supplier)
                .where(eq(supplier.tenantId, a.user.tenantId))
            ).map((x) => x.c);
            const clean = sanitise(b.query, names);
            if (tokensOf(clean.sent.replace(/\[withheld\]/g, ' ')).length === 0)
              external.note =
                'Nothing of the question was left once identifiers were withheld, so nothing was sent.';
            else {
              // SEC-D05 and SEC-D09: the question leaves the application, so the allow-list and the hosting country apply first
              await assertOutbound(tx, a.user.tenantId, {
                purpose: 'EXTERNAL_SEARCH',
                target: {
                  label: provider.name,
                  host: provider.host ?? 'search.simulated.test',
                  region: provider.region ?? 'AU',
                },
                actorId: a.user.id,
                settings: s,
              });
              // SEC-AP08: what comes back is untrusted data: made inert, and flagged when it reads like instructions
              const hits: Array<ExternalHit & { flagged?: boolean }> = [];
              for (const h of await provider.search(clean.sent)) {
                const n = neutralise(
                  `${h.title}
${h.snippet}`,
                  'outside search',
                );
                if (n.flagged)
                  await flagContent(tx, a.user.tenantId, {
                    source: 'SEARCH_RESULT',
                    entityType: 'search',
                    text: `${h.title}
${h.snippet}`,
                    actorId: a.user.id,
                  });
                hits.push(
                  n.flagged
                    ? {
                        title: neutralise(h.title).clean,
                        snippet: neutralise(h.snippet).clean,
                        source: h.source,
                        flagged: true,
                      }
                    : h,
                );
              }
              await tx.insert(externalSearchLog).values({
                tenantId: a.user.tenantId,
                userId: a.user.id,
                querySent: clean.sent,
                provider: provider.name,
                withheld: clean.withheld,
                createdAt: d.clock.now(),
              });
              await d.audit.record(tx, a.ctx, {
                action: 'search.external',
                entityType: 'tenant',
                entityId: a.user.tenantId,
                after: { provider: provider.name, sent: clean.sent, withheld: clean.withheld.length },
              });
              external = { ...external, asked: true, sent: clean.sent, withheld: clean.withheld, hits };
            }
          }
        }
        return {
          model: SEARCH_MODEL,
          query: b.query,
          groups,
          total: groups.reduce((n, g) => n + g.total, 0),
          external,
        };
      });
    },
  );

  reg('GET', '/search/external-log');
  app.get(`${p}/search/external-log`, { preHandler: guard(d, ['ADMIN', 'PROBITY', 'EXEC']) }, async (req) => {
    const a = req.auth!;
    return withContext(d.database, a.ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(externalSearchLog)
        .where(eq(externalSearchLog.tenantId, a.user.tenantId))
        .orderBy(desc(externalSearchLog.createdAt))
        .limit(100);
      return rows.map((r) => ({
        id: r.id,
        sent: r.querySent,
        provider: r.provider,
        withheld: r.withheld as string[],
        at: r.createdAt.toISOString(),
      }));
    });
  });
  return done;
}
