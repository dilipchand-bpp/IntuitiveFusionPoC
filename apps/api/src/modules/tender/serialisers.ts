/**
 * The ONLY functions that turn question, addendum and file rows into API responses.
 * Anonymity rule (FR-0135): a question's author is never returned by any response. These serialisers copy fields
 * one by one from an allow-list, so a new column can never leak by accident; a test also scans the source tree
 * to prove `askedBySupplierId` is only ever written, never read into a response.
 */
import type { addendum, fileObject, question } from '../../db/schema.js';

export const questionView = (q: typeof question.$inferSelect) => ({
  id: q.id,
  text: q.text,
  status: q.status,
  askedAt: q.askedAt.toISOString(),
  /** SINGLE: the answer goes only to the supplier who asked (FR-0195). The asker is never named. */
  audience: q.audience,
  ...(q.answer ? { answer: q.answer } : {}),
});

export const addendumView = (a: typeof addendum.$inferSelect) => ({
  id: a.id,
  number: a.number,
  summary: a.summary,
  questionIds: a.questionIds as string[],
  ...(a.newClosesAt ? { newClosesAt: a.newClosesAt.toISOString() } : {}),
  issuedAt: a.issuedAt.toISOString(),
});

export const fileView = (f: typeof fileObject.$inferSelect) => ({
  id: f.id,
  name: f.name,
  sizeBytes: f.sizeBytes,
  contentType: f.contentType,
  section: f.section,
  scan: f.scan,
  ...(f.sha256 ? { sha256: f.sha256 } : {}),
  /** True when this file came from the supplier's earlier stage and was not replaced (FR-0230). */
  ...(f.carriedFrom ? { carriedForward: true } : {}),
  uploadedAt: f.createdAt.toISOString(),
});
