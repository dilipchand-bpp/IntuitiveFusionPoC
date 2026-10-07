/**
 * SEC-AP08: prompt-injection resistance for supplier and uploaded content.
 *
 * Everything a supplier wrote or uploaded that can reach an AI-labelled path (Ask AI context, evaluation report
 * summaries, legal-edit parsing, response summaries, clarification answers, lessons recall, search) is treated as DATA,
 * never as instructions:
 *   (a) `neutralise` strips or escapes hidden characters, markup and tool-call syntax,
 *   (b) it wraps the text in clearly delimited data markers that the text itself cannot close,
 *   (c) `injectionSignals` flags instruction-like text so a reviewer sees "Contains instruction-like text",
 *   (d) no score, compliance result, route or rule in this application is ever computed from free text: scores come from
 *       evaluators, compliance from checks, routing from value and role. A supplier cannot talk the platform into a result.
 *
 * Deterministic and labelled rules-simulated-v1: fixed patterns, no model. A real classifier model can replace
 * `injectionSignals` (docs/swap-points.md); the wrapping and the rule that text never decides anything stay.
 */
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../../audit/audit-service.js';
import type { RequestContext, Tx } from '../../db/client.js';
import { contentFlag } from '../../db/schema.js';
import { outboundClock } from './outbound.js';

export const CONTENT_MODEL = 'rules-simulated-v1';
export const FLAG_MARKER = 'Contains instruction-like text';

export interface Signal {
  code: string;
  label: string;
}

const RULES: Array<{ code: string; label: string; test: RegExp }> = [
  {
    code: 'IGNORE_INSTRUCTIONS',
    label: 'Tells the reader to ignore or override its instructions or rules',
    test: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|the|your|these)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|guidelines?|polic(?:y|ies)|criteria|checks?)\b/i,
  },
  {
    code: 'SYSTEM_PROMPT',
    label: 'Mentions the system prompt or developer instructions',
    test: /\b(system|developer)\s+(prompt|message|instructions?)\b/i,
  },
  {
    code: 'ROLE_REASSIGNMENT',
    label: 'Tries to give the reader a new role',
    test: /\b(you are now|act as|pretend (?:to be|you are)|from now on,? you|new instructions?:)/i,
  },
  {
    code: 'ROLE_MARKER',
    label: 'Contains a chat role marker',
    test: /(^|\n)\s*(system|assistant|user|human|ai)\s*:|<\|im_(start|end)\|>|\[\/?INST\]|###\s*(instruction|system)/i,
  },
  {
    code: 'TOOL_CALL',
    label: 'Contains tool-call or function-call syntax',
    test: /<\s*\/?\s*(tool|function|invoke)[\w_ -]*>|\bfunction_call\b|"tool_calls?"\s*:|\btool_use\b/i,
  },
  {
    code: 'DECISION_DEMAND',
    label: 'Demands a decision, score or ranking',
    test: /\b(approve (?:this|it|us|the bid)|score\b[^.\n]{0,25}\b\d+\s*\/\s*\d+|(?:give|award|grant)\b[^.\n]{0,25}\b(?:full marks|maximum score|10\s*\/\s*10)|mark (?:this |it )?(?:as )?compliant|rank (?:us|this|it) (?:first|#?1)|award (?:the contract )?to us)\b/i,
  },
  {
    code: 'HIDDEN_CHARACTERS',
    label: 'Contains hidden or direction-changing characters',
    test: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/,
  },
  {
    code: 'MARKUP_INJECTION',
    label: 'Contains HTML or markdown that could carry a payload',
    test: /<\s*(script|iframe|img|object|embed|style|svg|link|meta|form)\b|javascript:|\son\w+\s*=|!\[[^\]]*\]\(\s*https?:|\]\(\s*javascript:/i,
  },
  {
    code: 'LONG_BASE64',
    label: 'Contains a long encoded block',
    test: /[A-Za-z0-9+/]{80,}={0,2}/,
  },
];

export function injectionSignals(text: string): Signal[] {
  return RULES.filter((r) => r.test.test(text)).map((r) => ({ code: r.code, label: r.label }));
}

const HIDDEN = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const OPEN_MARK = /<<<\s*(END_)?(SUPPLIER|UPLOADED)_DATA[^>]*>>>/gi;

export interface Neutralised {
  /** The text with hidden characters removed and markup, links and tool-call syntax made inert. */
  clean: string;
  /** `clean` inside delimiters that mark it as untrusted data; what any AI-labelled path should be given. */
  wrapped: string;
  signals: Signal[];
  flagged: boolean;
  hiddenRemoved: number;
}

/** Makes untrusted text inert and marks it as data. Never throws; never changes meaning silently (the original is not altered in place). */
export function neutralise(text: string, source = 'supplier content'): Neutralised {
  const signals = injectionSignals(text);
  const hiddenRemoved = (text.match(HIDDEN) ?? []).length;
  const clean = text
    .replace(HIDDEN, '')
    .replace(OPEN_MARK, '[marker removed]')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '[image removed: $1]')
    .replace(/\]\(\s*(javascript|data):[^)]*\)/gi, '](link removed)')
    .replace(/(^|\n)(\s*)(system|assistant|user|human|ai)\s*:/gi, '$1$2[role marker removed] $3 -')
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[encoded block removed]');
  const safeSource = source.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 40);
  return {
    clean,
    wrapped: `<<<SUPPLIER_DATA source="${safeSource}" untrusted="true">>>\n${clean}\n<<<END_SUPPLIER_DATA>>>`,
    signals,
    flagged: signals.length > 0,
    hiddenRemoved,
  };
}

export interface FlagRequest {
  /** Where the text came from, for example CLARIFICATION_ANSWER, RESPONSE_ANSWER, LESSON, SEARCH_RESULT, ASK_AI. */
  source: string;
  entityType: string;
  entityId?: string | null;
  text: string;
  actorId?: string | null;
}

/**
 * Screens text that reached an AI-labelled path. Records a flag (and an audit event) only when something instruction-like
 * is found. Never changes the text, never blocks the write, never feeds any decision.
 */
export async function flagContent(
  tx: Tx,
  tenantId: string,
  req: FlagRequest,
): Promise<{ flagged: boolean; signals: Signal[] }> {
  const n = neutralise(req.text, req.source);
  if (!n.flagged) return { flagged: false, signals: [] };
  const clock = outboundClock();
  const [row] = await tx
    .insert(contentFlag)
    .values({
      tenantId,
      source: req.source,
      entityType: req.entityType,
      entityId: req.entityId ?? null,
      signals: n.signals,
      excerpt: n.clean.replace(/\s+/g, ' ').slice(0, 240),
      actorId: req.actorId ?? null,
      createdAt: clock.now(),
    })
    .returning({ id: contentFlag.id });
  const ctx: RequestContext = { tenantId, userId: req.actorId ?? null, role: req.actorId ? null : 'SYSTEM' };
  await new AuditService(clock).record(tx, ctx, {
    action: 'content.flagged',
    entityType: 'content_flag',
    entityId: row!.id,
    after: { source: req.source, entityType: req.entityType, signals: n.signals.map((s) => s.code) },
  });
  return { flagged: true, signals: n.signals };
}

/** Whether an entity has an open flag, for the marker shown to reviewers. */
export async function flaggedEntities(tx: Tx, tenantId: string, entityType: string, ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const rows = await tx
    .select({ id: contentFlag.entityId })
    .from(contentFlag)
    .where(and(eq(contentFlag.tenantId, tenantId), eq(contentFlag.entityType, entityType)))
    .orderBy(desc(contentFlag.createdAt));
  const want = new Set(ids);
  return new Set(rows.map((r) => r.id).filter((x): x is string => x !== null && want.has(x)));
}
