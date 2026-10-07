import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { Clock } from '@if/shared';
import { withContext, type Database, type RequestContext, type Tx } from '../db/client.js';
import { auditEvent, tenant } from '../db/schema.js';

export const GENESIS = 'GENESIS';
const REDACTED = '[REDACTED]';
// bank details (SEC-AC10): the BSB and the account number never reach the log, whichever module writes the event
const SENSITIVE_KEY =
  /pass(word)?|secret|token|hash$|authorization|cookie|api[-_]?key|credential|^bsb$|^account$|account[-_]?(number|no)$/i;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface AuditInput {
  action: string; // e.g. 'plan.approve'
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  result?: 'SUCCESS' | 'DENIED' | 'FAILED';
}

/** Replaces values of sensitive keys at any depth. Applied at source so secrets never reach the log. */
export function redact(value: unknown): Json {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value as Json;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SENSITIVE_KEY.test(k) ? REDACTED : redact(v),
    ]),
  );
}

/** Deterministic JSON: keys sorted at every depth, so hashes do not depend on property order (JSONB reorders keys). */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

/** Field-level before/after: only keys whose values changed (SEC-L03). Creates keep all of `after`; deletes all of `before`. */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Json; after: Json } {
  const b = redact(before ?? null);
  const a = redact(after ?? null);
  if (
    b === null ||
    a === null ||
    typeof b !== 'object' ||
    typeof a !== 'object' ||
    Array.isArray(b) ||
    Array.isArray(a)
  ) {
    return { before: b, after: a };
  }
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const outB: Record<string, Json> = {};
  const outA: Record<string, Json> = {};
  for (const k of keys) {
    if (canonical(b[k]) !== canonical(a[k])) {
      if (k in b) outB[k] = b[k] as Json;
      if (k in a) outA[k] = a[k] as Json;
    }
  }
  return { before: outB, after: outA };
}

interface HashedFields {
  tenantId: string;
  at: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Json;
  after: Json;
  correlationId: string | null;
  result: string;
}
export const computeHash = (prevHash: string, f: HashedFields) =>
  createHash('sha256').update(prevHash).update('\n').update(canonical(f)).digest('hex');

export class AuditService {
  constructor(private readonly clock: Clock) {}

  /**
   * Appends one audit event INSIDE the caller's transaction, so a business change cannot commit without its audit
   * record and a failed audit write rolls the change back (fail closed). The tenant row is locked to serialise
   * the chain per tenant.
   */
  async record(tx: Tx, ctx: RequestContext, input: AuditInput): Promise<number> {
    await tx.execute(sql`select 1 from ${tenant} where ${tenant.id} = ${ctx.tenantId} for update`);
    const last = await tx
      .select({ hash: auditEvent.hash })
      .from(auditEvent)
      .where(eq(auditEvent.tenantId, ctx.tenantId))
      .orderBy(desc(auditEvent.seq))
      .limit(1);
    const prevHash = last[0]?.hash ?? GENESIS;
    const { before, after } = diff(input.before, input.after);
    const at = this.clock.now();
    const fields: HashedFields = {
      tenantId: ctx.tenantId,
      at: at.toISOString(),
      actorId: ctx.userId,
      actorRole: ctx.role,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before,
      after,
      correlationId: ctx.correlationId ?? null,
      result: input.result ?? 'SUCCESS',
    };
    const hash = computeHash(prevHash, fields);
    const [row] = await tx
      .insert(auditEvent)
      .values({
        tenantId: ctx.tenantId,
        at,
        actorId: ctx.userId,
        actorRole: ctx.role,
        action: fields.action,
        entityType: fields.entityType,
        entityId: fields.entityId,
        before: before as never,
        after: after as never,
        correlationId: fields.correlationId,
        result: fields.result as 'SUCCESS',
        prevHash,
        hash,
      })
      .returning({ seq: auditEvent.seq });
    return row!.seq;
  }

  /** Records a denial/failure in its own transaction (the business transaction has already rolled back). */
  async recordOutsideTx(database: Database, ctx: RequestContext, input: AuditInput): Promise<number> {
    return withContext(database, ctx, (tx) => this.record(tx, ctx, input));
  }

  /** Re-computes the whole chain for a tenant. Returns the first broken sequence number, if any. */
  async verifyChain(
    database: Database,
    tenantId: string,
  ): Promise<{ ok: boolean; checked: number; brokenAtSeq?: number; reason?: string }> {
    let prev = GENESIS;
    let checked = 0;
    let cursor = 0;
    for (;;) {
      const batch = await database.db
        .select()
        .from(auditEvent)
        .where(and(eq(auditEvent.tenantId, tenantId), gt(auditEvent.seq, cursor)))
        .orderBy(asc(auditEvent.seq))
        .limit(500);
      if (batch.length === 0) break;
      for (const r of batch) {
        if (r.prevHash !== prev)
          return {
            ok: false,
            checked,
            brokenAtSeq: r.seq,
            reason: 'prev_hash does not match the preceding event (event removed or reordered)',
          };
        const expected = computeHash(prev, {
          tenantId: r.tenantId,
          at: r.at.toISOString(),
          actorId: r.actorId,
          actorRole: r.actorRole,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          before: (r.before ?? null) as Json,
          after: (r.after ?? null) as Json,
          correlationId: r.correlationId,
          result: r.result,
        });
        if (expected !== r.hash)
          return {
            ok: false,
            checked,
            brokenAtSeq: r.seq,
            reason: 'event content does not match its hash (event altered)',
          };
        prev = r.hash;
        checked++;
        cursor = r.seq;
      }
    }
    return { ok: true, checked };
  }
}
