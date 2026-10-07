/**
 * SEC-D07: the classification scan. Reads the text-bearing columns of the main tables, classifies each value with the
 * rules in classify.ts and keeps one `data_classification` row per entity and field.
 *
 * Idempotent: running it again finds the same rows and changes nothing (a value whose text changed is re-classified and
 * its review is reset; a value that no longer contains anything sensitive loses its row). The sensitive value is never
 * stored: only the detector names, the class and a masked sample.
 *
 * Scanned: request titles and fields (background and the rest), plan and document fields, lessons, review notes, contract
 * clauses, clarifications and tender questions, contract questions and comments, intake chat transcripts, probity
 * documents. Uploaded files are held sealed on disk and are NOT read here (documented limit).
 */
import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { RequestContext, Tx } from '../../db/client.js';
import {
  chatMessage,
  clarification,
  clause,
  contractComment,
  contractQuestion,
  dataClassification,
  fieldValue,
  lesson,
  probityDocument,
  question,
  request,
  reviewNote,
} from '../../db/schema.js';
import { AuditService } from '../../audit/audit-service.js';
import { CLASSIFIER_MODEL, DETECTORS, classifyText, warningFor } from './classify.js';
import { outboundClock } from './outbound.js';

export interface ScanItem {
  entityType: string;
  entityId: string;
  field: string;
  text: string;
  /** The kind of place, for the expected-detector table in classify.ts. */
  place: string;
  /** What to call the place in a warning. */
  where: string;
}

export const PLACEHOLDER = '[removed by retention policy]';

/** Collects every scannable value for the tenant. */
export async function collectItems(tx: Tx, tenantId: string): Promise<ScanItem[]> {
  const items: ScanItem[] = [];
  const add = (i: ScanItem | null) => {
    if (i && i.text && i.text.trim().length > 3) items.push(i);
  };

  for (const r of await tx.select().from(request).where(eq(request.tenantId, tenantId)))
    add({
      entityType: 'request',
      entityId: r.id,
      field: 'Title',
      text: r.title,
      place: 'request',
      where: `the title of request ${r.number}`,
    });

  for (const f of await tx.select().from(fieldValue).where(eq(fieldValue.tenantId, tenantId)))
    add({
      entityType: 'field_value',
      entityId: f.id,
      field: `${f.ownerType.toLowerCase().replace('_', ' ')}: ${f.label}`,
      text: f.value ?? '',
      place: f.ownerType === 'REQUEST' ? 'request' : f.ownerType === 'PLAN' ? 'plan' : 'document',
      where: `the ${f.ownerType.toLowerCase().replace('_', ' ')} field "${f.label}"`,
    });

  for (const l of await tx.select().from(lesson).where(eq(lesson.tenantId, tenantId)))
    add({
      entityType: 'lesson',
      entityId: l.id,
      field: 'Lesson text',
      text: l.text,
      place: 'lesson',
      where: 'a lesson learned',
    });

  for (const n of await tx.select().from(reviewNote).where(eq(reviewNote.tenantId, tenantId)))
    add({
      entityType: 'review_note',
      entityId: n.id,
      field: `Review note (${n.visibility.toLowerCase()})`,
      text: n.text,
      place: 'review_note',
      where: 'a supplier review note',
    });

  for (const c of await tx.select().from(clause).where(eq(clause.tenantId, tenantId)))
    add({
      entityType: 'clause',
      entityId: c.id,
      field: `Clause: ${c.title}`,
      text: c.text,
      place: 'clause',
      where: `the contract clause "${c.title}"`,
    });

  for (const c of await tx.select().from(clarification).where(eq(clarification.tenantId, tenantId))) {
    add({
      entityType: 'clarification',
      entityId: c.id,
      field: 'Clarification request',
      text: c.question,
      place: 'message',
      where: 'a clarification request',
    });
    add({
      entityType: 'clarification',
      entityId: c.id,
      field: 'Clarification answer',
      text: c.response ?? '',
      place: 'message',
      where: 'a clarification answer',
    });
  }

  for (const q of await tx.select().from(question).where(eq(question.tenantId, tenantId))) {
    add({
      entityType: 'question',
      entityId: q.id,
      field: 'Tender question',
      text: q.text,
      place: 'message',
      where: 'a tender question',
    });
    add({
      entityType: 'question',
      entityId: q.id,
      field: 'Tender answer',
      text: q.answer ?? '',
      place: 'message',
      where: 'a tender answer',
    });
  }

  for (const q of await tx.select().from(contractQuestion).where(eq(contractQuestion.tenantId, tenantId))) {
    add({
      entityType: 'contract_question',
      entityId: q.id,
      field: 'Contract question',
      text: q.question,
      place: 'message',
      where: 'a contract question',
    });
    add({
      entityType: 'contract_question',
      entityId: q.id,
      field: 'Contract answer',
      text: q.answer ?? '',
      place: 'message',
      where: 'a contract answer',
    });
  }

  for (const c of await tx.select().from(contractComment).where(eq(contractComment.tenantId, tenantId)))
    add({
      entityType: 'contract_comment',
      entityId: c.id,
      field: 'Contract comment',
      text: c.body,
      place: 'message',
      where: 'a contract comment',
    });

  for (const m of await tx.select().from(chatMessage).where(eq(chatMessage.tenantId, tenantId)))
    if (m.role === 'USER' && m.text !== PLACEHOLDER)
      add({
        entityType: 'chat_message',
        entityId: m.id,
        field: 'Intake chat message',
        text: m.text,
        place: 'chat',
        where: 'an intake chat message',
      });

  for (const d of await tx.select().from(probityDocument).where(eq(probityDocument.tenantId, tenantId)))
    add({
      entityType: 'probity_document',
      entityId: d.id,
      field: `Probity ${d.kind.toLowerCase()} document`,
      text: d.body,
      place: 'document',
      where: `the probity ${d.kind.toLowerCase()} document`,
    });

  return items;
}

const hashOf = (s: string) => createHash('sha256').update(s).digest('hex');
const key = (e: string, id: string, f: string) => `${e}:${id}:${f}`;

export interface ScanResult {
  model: string;
  scanned: number;
  findings: number;
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  warnings: number;
}

export async function runScan(
  tx: Tx,
  tenantId: string,
  actorId: string | null,
  trigger: 'MANUAL' | 'SCHEDULED',
): Promise<ScanResult> {
  const clock = outboundClock();
  const now = clock.now();
  const items = await collectItems(tx, tenantId);
  const existing = new Map(
    (await tx.select().from(dataClassification).where(eq(dataClassification.tenantId, tenantId))).map((r) => [
      key(r.entityType, r.entityId, r.field),
      r,
    ]),
  );
  const seen = new Set<string>();
  const res: ScanResult = {
    model: CLASSIFIER_MODEL,
    scanned: items.length,
    findings: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    warnings: 0,
  };
  for (const it of items) {
    const c = classifyText(it.text);
    const k = key(it.entityType, it.entityId, it.field);
    const prev = existing.get(k);
    if (!c) continue; // nothing found: any earlier row for it is removed below
    seen.add(k);
    res.findings += 1;
    const warning = warningFor(it.place, it.where, c.detectors);
    if (warning) res.warnings += 1;
    const contentHash = hashOf(`${it.text}|${CLASSIFIER_MODEL}`);
    const sample = c.samples
      .slice(0, 3)
      .map((s) => `${DETECTORS[s.detector].label}: ${s.sample}`)
      .join('; ');
    if (!prev) {
      await tx.insert(dataClassification).values({
        tenantId,
        entityType: it.entityType,
        entityId: it.entityId,
        field: it.field,
        class: c.class,
        detectors: c.detectors,
        maskedSample: sample,
        contentHash,
        warning,
        model: CLASSIFIER_MODEL,
        firstSeenAt: now,
        scannedAt: now,
      });
      res.created += 1;
    } else if (prev.contentHash !== contentHash) {
      await tx
        .update(dataClassification)
        .set({
          class: c.class,
          detectors: c.detectors,
          maskedSample: sample,
          contentHash,
          warning,
          status: 'OPEN',
          reviewedBy: null,
          reviewedAt: null,
          reviewReason: null,
          scannedAt: now,
        })
        .where(eq(dataClassification.id, prev.id));
      res.updated += 1;
    } else {
      if (prev.scannedAt.getTime() !== now.getTime())
        await tx.update(dataClassification).set({ scannedAt: now }).where(eq(dataClassification.id, prev.id));
      res.unchanged += 1;
    }
  }
  const stale = [...existing.entries()].filter(([k]) => !seen.has(k)).map(([, r]) => r.id);
  if (stale.length) {
    await tx.delete(dataClassification).where(inArray(dataClassification.id, stale));
    res.removed = stale.length;
  }
  const ctx: RequestContext = { tenantId, userId: actorId, role: actorId ? null : 'SYSTEM' };
  // an unchanged re-scan leaves no audit noise
  if (res.created + res.updated + res.removed > 0 || trigger === 'MANUAL')
    await new AuditService(clock).record(tx, ctx, {
      action: 'classification.scan',
      entityType: 'tenant',
      entityId: tenantId,
      after: { trigger, ...res },
    });
  return res;
}
