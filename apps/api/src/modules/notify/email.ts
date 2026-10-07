/**
 * Email to people who may not have an account yet (suppliers invited to a tender, a new supplier contact, a supplier
 * told they were not shortlisted). SIMULATED in the proof of concept: nothing is sent; the message that would have been
 * sent is recorded so it can be read (swap point: docs/swap-points.md, "Email and chat"). One-time links are never
 * written into a message: the body says a link was issued, because the log can be read by administrators.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { connector, outboundEmail } from '../../db/schema.js';
import { providerEntry } from '../b10conn/catalogue.js';
import { checkOutbound } from '../b11priv/outbound.js';

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
    | 'WELCOME'
    | 'CLARIFICATION'
    | 'BAFO'
    | 'SIGNING_INVITATION'
    | 'SIGNING_REMINDER';
  refType?: string;
  refId?: string;
}

export async function sendEmail(tx: Tx, e: EmailInput): Promise<string> {
  // SEC-D09 and SEC-D05: the email and SMS gateway is outside the application, so its region and host are checked.
  // A message that may not go is kept (status BLOCKED_...) so a person can see what was not sent and why.
  const [gw] = await tx
    .select({ provider: connector.provider })
    .from(connector)
    .where(and(eq(connector.tenantId, e.tenantId), eq(connector.kind, 'MESSAGING')));
  const entry = providerEntry('MESSAGING', gw?.provider ?? 'SIMULATED_MESSAGING');
  const refused = entry
    ? await checkOutbound(tx, e.tenantId, {
        purpose: 'EMAIL_SMS',
        target: { label: entry.label, host: entry.host, region: entry.region },
      })
    : null;
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
      status: refused
        ? refused.code === 'EGRESS_BLOCKED'
          ? 'BLOCKED_EGRESS'
          : 'BLOCKED_RESIDENCY'
        : 'SIMULATED',
    })
    .returning({ id: outboundEmail.id });
  return row!.id;
}
