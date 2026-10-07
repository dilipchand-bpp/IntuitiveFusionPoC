/**
 * SEC-D06: AI conversations are held under the same retention and residency controls as everything else.
 *
 * What is a "conversation" here: the intake chat (`conversation` and `chat_message`), the only AI conversation this
 * platform stores. The Ask AI box (POST /assistant/chat) answers and keeps nothing, so there is no transcript to retain.
 *
 *  - Residency: a conversation is stamped with a retention class and the AI region when it starts, and the conversation
 *    endpoints refuse to store anything when the tenant's AI region is not an allowed region (SEC-D09, ties to #1).
 *  - Retention: the `retention.aiConversationDays` setting (default 365, minimum 30). The purge job anonymises the text of
 *    expired transcripts and keeps the shell (who, when, the request it led to). It never touches audit events.
 *  - Legal hold: a held conversation, or one whose request is held, is skipped, and the skip and the reason are recorded.
 */
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AuditService } from '../../audit/audit-service.js';
import { withContext, type Database, type RequestContext, type Tx } from '../../db/client.js';
import { chatMessage, conversation, conversationMeta, legalHold, retentionRun } from '../../db/schema.js';
import { loadSettings } from '../settings/settings.js';
import { PLACEHOLDER } from './classification.js';
import { assertOutbound, checkOutbound, outboundClock } from './outbound.js';

export const RETENTION_CLASS = 'AI_CONVERSATION';

/** Refuses (422 RESIDENCY_VIOLATION, audited, counted) when the tenant's AI region is not an allowed region. */
export async function assertAiConversationRegion(database: Database, ctx: RequestContext): Promise<void> {
  const refusal = await withContext(database, ctx, async (tx) => {
    const s = await loadSettings(tx, ctx.tenantId);
    return checkOutbound(tx, ctx.tenantId, {
      purpose: 'AI_CONVERSATION_STORE',
      target: { label: 'AI conversation store', region: s.residency.aiRegion },
      actorId: ctx.userId,
      settings: s,
    });
  });
  if (refusal) throw refusal;
}

/** The same check inside a transaction the caller will commit (the caller wraps it in `refusable`). */
export const assertAiConversationRegionTx = async (tx: Tx, ctx: RequestContext) => {
  const s = await loadSettings(tx, ctx.tenantId);
  await assertOutbound(tx, ctx.tenantId, {
    purpose: 'AI_CONVERSATION_STORE',
    target: { label: 'AI conversation store', region: s.residency.aiRegion },
    actorId: ctx.userId,
    settings: s,
  });
};

/** Stamps a new conversation with its retention class and the region it is held in. */
export async function stampConversation(tx: Tx, tenantId: string, conversationId: string): Promise<void> {
  const s = await loadSettings(tx, tenantId);
  await tx
    .insert(conversationMeta)
    .values({
      conversationId,
      tenantId,
      retentionClass: RETENTION_CLASS,
      region: s.residency.aiRegion,
      stampedAt: outboundClock().now(),
    })
    .onConflictDoNothing();
}

export interface RetentionResult {
  retentionDays: number;
  cutoff: string;
  expired: number;
  anonymised: number;
  messagesCleared: number;
  skippedHeld: number;
  held: Array<{ conversationId: string; holdId: string; reason: string; via: 'CONVERSATION' | 'REQUEST' }>;
  stampedNow: number;
}

/** One purge pass for one tenant. Running it twice is safe: the second pass finds nothing new. */
export async function runRetention(
  tx: Tx,
  tenantId: string,
  actorId: string | null,
  trigger: 'MANUAL' | 'SCHEDULED',
): Promise<RetentionResult> {
  const clock = outboundClock();
  const now = clock.now();
  const s = await loadSettings(tx, tenantId);
  const days = s.retention.aiConversationDays;
  const cutoff = new Date(now.getTime() - days * 86_400_000);

  // conversations that started before the stamp existed get one now, dated from when they were created
  const unstamped = await tx
    .select({ id: conversation.id, at: conversation.createdAt })
    .from(conversation)
    .leftJoin(conversationMeta, eq(conversationMeta.conversationId, conversation.id))
    .where(and(eq(conversation.tenantId, tenantId), isNull(conversationMeta.conversationId)));
  for (const u of unstamped)
    await tx
      .insert(conversationMeta)
      .values({
        conversationId: u.id,
        tenantId,
        retentionClass: RETENTION_CLASS,
        region: s.residency.aiRegion,
        stampedAt: u.at,
      })
      .onConflictDoNothing();

  const due = await tx
    .select({
      id: conversationMeta.conversationId,
      contextId: conversation.contextId,
    })
    .from(conversationMeta)
    .innerJoin(conversation, eq(conversation.id, conversationMeta.conversationId))
    .where(
      and(
        eq(conversationMeta.tenantId, tenantId),
        isNull(conversationMeta.anonymisedAt),
        lt(conversationMeta.stampedAt, cutoff),
      ),
    );
  const holds = await tx
    .select()
    .from(legalHold)
    .where(and(eq(legalHold.tenantId, tenantId), isNull(legalHold.releasedAt)));
  const holdFor = (c: { id: string; contextId: string | null }) => {
    const direct = holds.find((h) => h.entityType === 'CONVERSATION' && h.entityId === c.id);
    if (direct) return { hold: direct, via: 'CONVERSATION' as const };
    const viaReq = c.contextId
      ? holds.find((h) => h.entityType === 'REQUEST' && h.entityId === c.contextId)
      : undefined;
    return viaReq ? { hold: viaReq, via: 'REQUEST' as const } : null;
  };

  const out: RetentionResult = {
    retentionDays: days,
    cutoff: cutoff.toISOString(),
    expired: due.length,
    anonymised: 0,
    messagesCleared: 0,
    skippedHeld: 0,
    held: [],
    stampedNow: unstamped.length,
  };
  const toClear: string[] = [];
  for (const c of due) {
    const h = holdFor(c);
    if (h) {
      out.skippedHeld += 1;
      out.held.push({ conversationId: c.id, holdId: h.hold.id, reason: h.hold.reason, via: h.via });
    } else toClear.push(c.id);
  }
  if (toClear.length) {
    const cleared = await tx
      .update(chatMessage)
      .set({ text: PLACEHOLDER, proposedChanges: null })
      .where(and(inArray(chatMessage.conversationId, toClear), sql`${chatMessage.text} <> ${PLACEHOLDER}`))
      .returning({ id: chatMessage.id });
    out.messagesCleared = cleared.length;
    await tx
      .update(conversationMeta)
      .set({ anonymisedAt: now })
      .where(inArray(conversationMeta.conversationId, toClear));
    out.anonymised = toClear.length;
  }
  await tx.insert(retentionRun).values({
    tenantId,
    ranAt: now,
    ranBy: actorId,
    trigger,
    retentionDays: days,
    expired: out.expired,
    anonymised: out.anonymised,
    messagesCleared: out.messagesCleared,
    skippedHeld: out.skippedHeld,
    held: out.held,
  });
  // the purge touches conversations only; audit events are never changed or removed (SEC-L02)
  if (out.anonymised > 0 || out.skippedHeld > 0 || trigger === 'MANUAL') {
    const ctx: RequestContext = { tenantId, userId: actorId, role: actorId ? null : 'SYSTEM' };
    await new AuditService(clock).record(tx, ctx, {
      action: 'retention.run',
      entityType: 'tenant',
      entityId: tenantId,
      after: {
        trigger,
        retentionDays: days,
        expired: out.expired,
        anonymised: out.anonymised,
        skippedHeld: out.skippedHeld,
        held: out.held.map((h) => ({ conversationId: h.conversationId, reason: h.reason, via: h.via })),
      },
    });
  }
  return out;
}
