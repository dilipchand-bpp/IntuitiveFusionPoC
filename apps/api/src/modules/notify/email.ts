/**
 * Email to people who may not have an account yet (suppliers invited to a tender, a new supplier contact, a supplier
 * told they were not shortlisted). SIMULATED in the proof of concept: nothing is sent; the message that would have been
 * sent is recorded so it can be read (swap point: docs/swap-points.md, "Email and chat"). One-time links are never
 * written into a message: the body says a link was issued, because the log can be read by administrators.
 */
import type { Tx } from '../../db/client.js';
import { outboundEmail } from '../../db/schema.js';

export interface EmailInput {
  tenantId: string;
  to: string;
  subject: string;
  body: string;
  kind:
    | 'TENDER_INVITATION'
    | 'TENDER_PUBLISHED'
    | 'ADDENDUM'
    | 'DATES_CHANGED'
    | 'ANSWER'
    | 'LATE_PERMISSION'
    | 'SHORTLISTED'
    | 'UNSUCCESSFUL'
    | 'CONTACT_ADDED'
    | 'CONTACT_REMOVED'
    | 'SANCTIONS_HOLD'
    | 'WELCOME';
  refType?: string;
  refId?: string;
}

export async function sendEmail(tx: Tx, e: EmailInput): Promise<string> {
  const [row] = await tx
    .insert(outboundEmail)
    .values({
      tenantId: e.tenantId,
      toEmail: e.to.trim().toLowerCase(),
      subject: e.subject.slice(0, 200),
      body: e.body.slice(0, 4000),
      kind: e.kind,
      refType: e.refType ?? null,
      refId: e.refId ?? null,
      status: 'SIMULATED',
    })
    .returning({ id: outboundEmail.id });
  return row!.id;
}
