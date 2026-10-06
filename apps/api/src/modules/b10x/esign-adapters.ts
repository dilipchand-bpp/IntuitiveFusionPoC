/**
 * The two simulated e-signature providers (NFR-C04): DocuSign and Adobe Acrobat Sign. Each adapter turns the same envelope
 * specification into that provider's own request shape, answers the create call, and reads that provider's own callback
 * vocabulary back into one canonical event. Nothing here talks to a real provider.
 *
 * SWAP POINT (docs/swap-points.md): a real adapter keeps `buildCreate` (the request body it POSTs to the provider),
 * `createEnvelope` (the provider's answer reduced to ids), `toCallback` (used only by the demonstration) and `parseCallback`
 * (what the signed inbound webhook hands to the platform). Callers only ever see the canonical shapes.
 */
import { createHash } from 'node:crypto';

export type CanonicalKind = 'sent' | 'delivered' | 'viewed' | 'signed' | 'declined' | 'voided' | 'expired';
export const CANONICAL_KINDS: readonly CanonicalKind[] = [
  'sent',
  'delivered',
  'viewed',
  'signed',
  'declined',
  'voided',
  'expired',
];
export type ProviderId = 'DOCUSIGN' | 'ADOBE';

export interface SignatorySpec {
  signatoryId: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  /** Signing order. Equal values sign in parallel; STAGED contracts get 1, 2, 3 ... */
  order: number;
  /** The simulated signing link (a platform page that mimics the provider's signing ceremony). */
  signUrl: string;
}
export interface EnvelopeSpec {
  contractId: string;
  contractNumber: string;
  title: string;
  mode: 'STANDARD' | 'BLIND' | 'STAGED';
  expiresAt: Date;
  signatories: SignatorySpec[];
  /** A number that differs for each envelope made for the same contract, so ids never repeat. */
  sequence: number;
  tenantId: string;
}
export interface CreateResult {
  externalId: string;
  status: string;
  recipients: Array<{ signatoryId: string; ref: string }>;
}
export interface ParsedCallback {
  externalId: string;
  kind: CanonicalKind;
  /** The provider's id for the recipient, when the message names one. */
  recipientRef: string | null;
  email: string | null;
  reason: string | null;
}
export interface Callback {
  type: string;
  data: Record<string, unknown>;
}

export interface EsignAdapter {
  id: ProviderId;
  label: string;
  /** The body the platform would POST to the provider to create the envelope. */
  buildCreate(spec: EnvelopeSpec): Record<string, unknown>;
  /** The provider's answer to that request (simulated, deterministic). */
  createEnvelope(spec: EnvelopeSpec): CreateResult;
  /** What this provider's callback looks like for a canonical event (used by the demonstration). */
  toCallback(i: {
    externalId: string;
    kind: CanonicalKind;
    recipientRef?: string | undefined;
    email?: string | undefined;
    reason?: string | undefined;
  }): Callback;
  /** Reads this provider's callback; null when it is not one of the events this adapter knows. */
  parseCallback(type: string, data: Record<string, unknown>): ParsedCallback | null;
  /** The envelope id inside a callback body, so the platform can find the envelope before it knows the provider. */
  externalIdOf(data: Record<string, unknown>): string | null;
}

const digest = (...parts: Array<string | number>) =>
  createHash('sha256').update(parts.join('|')).digest('hex');
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// ------------------------------------------------------------------ DocuSign
const DS_TYPES: Record<CanonicalKind, string> = {
  sent: 'recipient-sent',
  delivered: 'recipient-delivered',
  viewed: 'recipient-viewed',
  signed: 'recipient-completed',
  declined: 'recipient-declined',
  voided: 'envelope-voided',
  expired: 'envelope-expired',
};
const DS_STATUS: Record<CanonicalKind, string> = {
  sent: 'sent',
  delivered: 'delivered',
  viewed: 'delivered',
  signed: 'completed',
  declined: 'declined',
  voided: 'voided',
  expired: 'voided',
};

export const docusign: EsignAdapter = {
  id: 'DOCUSIGN',
  label: 'DocuSign',
  buildCreate(spec) {
    return {
      emailSubject: `Please sign ${spec.contractNumber}`,
      status: 'sent',
      documents: [{ documentId: '1', name: `${spec.contractNumber}.pdf`, fileExtension: 'pdf', order: '1' }],
      // DocuSign hides one signer's tabs from the others with enforceSignerVisibility
      enforceSignerVisibility: spec.mode === 'BLIND' ? 'true' : 'false',
      recipients: {
        signers: spec.signatories.map((s, i) => ({
          recipientId: String(i + 1),
          routingOrder: String(s.order),
          name: s.name,
          email: s.email,
          roleName: s.roleLabel,
          clientUserId: s.signatoryId,
          embeddedRecipientStartURL: s.signUrl,
        })),
      },
      notification: { useAccountDefaults: 'false', expirations: { expireEnabled: 'true' } },
      expireDateTime: spec.expiresAt.toISOString(),
      customFields: {
        textCustomFields: [
          { name: 'contractNumber', value: spec.contractNumber },
          { name: 'signingMode', value: spec.mode },
        ],
      },
    };
  },
  createEnvelope(spec) {
    const externalId = `DS-${digest(spec.tenantId, spec.contractId, spec.sequence, 'docusign').slice(0, 12)}`;
    return {
      externalId,
      status: 'sent',
      recipients: spec.signatories.map((s, i) => ({ signatoryId: s.signatoryId, ref: String(i + 1) })),
    };
  },
  toCallback(i) {
    return {
      type: DS_TYPES[i.kind],
      data: {
        envelopeId: i.externalId,
        status: DS_STATUS[i.kind],
        ...(i.recipientRef ? { recipientId: i.recipientRef } : {}),
        ...(i.email ? { email: i.email } : {}),
        ...(i.reason ? { declinedReason: i.reason } : {}),
      },
    };
  },
  parseCallback(type, data) {
    const kind = (Object.keys(DS_TYPES) as CanonicalKind[]).find((k) => DS_TYPES[k] === type);
    const externalId = str(data.envelopeId);
    if (!kind || !externalId) return null;
    return {
      externalId,
      kind,
      recipientRef: str(data.recipientId),
      email: str(data.email),
      reason: str(data.declinedReason),
    };
  },
  externalIdOf: (data) => str(data.envelopeId),
};

// ------------------------------------------------------------------ Adobe Acrobat Sign
const AD_TYPES: Record<CanonicalKind, string> = {
  sent: 'AGREEMENT_ACTION_REQUESTED',
  delivered: 'AGREEMENT_ACTION_DELIVERED',
  viewed: 'AGREEMENT_ACTION_VIEWED',
  signed: 'AGREEMENT_ACTION_COMPLETED',
  declined: 'AGREEMENT_ACTION_REJECTED',
  voided: 'AGREEMENT_RECALLED',
  expired: 'AGREEMENT_EXPIRED',
};

export const adobe: EsignAdapter = {
  id: 'ADOBE',
  label: 'Adobe Acrobat Sign',
  buildCreate(spec) {
    return {
      name: `${spec.contractNumber} ${spec.title}`.slice(0, 255),
      state: 'IN_PROCESS',
      signatureType: 'ESIGN',
      externalId: { id: spec.contractNumber },
      message: `Please review and sign ${spec.contractNumber}.`,
      fileInfos: [{ transientDocumentId: `TD-${digest(spec.contractId, spec.sequence).slice(0, 10)}` }],
      expirationTime: spec.expiresAt.toISOString(),
      // Adobe groups recipients into participant sets; the set's order is the signing order
      participantSetsInfo: spec.signatories.map((s) => ({
        order: s.order,
        role: 'SIGNER',
        label: s.roleLabel,
        // Adobe hides the other participants' details when the agreement is set to private
        privateMessage: spec.mode === 'BLIND' ? 'HIDE_OTHER_PARTICIPANTS' : undefined,
        memberInfos: [{ email: s.email, name: s.name, securityOption: { authenticationMethod: 'NONE' } }],
        redirectUrl: s.signUrl,
      })),
    };
  },
  createEnvelope(spec) {
    const externalId = `AG-${digest(spec.tenantId, spec.contractId, spec.sequence, 'adobe').slice(0, 14).toUpperCase()}`;
    return {
      externalId,
      status: 'IN_PROCESS',
      recipients: spec.signatories.map((s, i) => ({
        signatoryId: s.signatoryId,
        ref: `PS-${digest(externalId, i).slice(0, 8)}`,
      })),
    };
  },
  toCallback(i) {
    return {
      type: AD_TYPES[i.kind],
      data: {
        event: AD_TYPES[i.kind],
        agreement: { id: i.externalId, status: i.kind === 'voided' ? 'CANCELLED' : 'OUT_FOR_SIGNATURE' },
        ...(i.email ? { participantUserEmail: i.email } : {}),
        ...(i.recipientRef ? { participantSetId: i.recipientRef } : {}),
        ...(i.reason ? { comment: i.reason } : {}),
      },
    };
  },
  parseCallback(type, data) {
    const kind = (Object.keys(AD_TYPES) as CanonicalKind[]).find((k) => AD_TYPES[k] === type);
    const externalId = str(obj(data.agreement).id);
    if (!kind || !externalId) return null;
    return {
      externalId,
      kind,
      recipientRef: str(data.participantSetId),
      email: str(data.participantUserEmail),
      reason: str(data.comment),
    };
  },
  externalIdOf: (data) => str(obj(data.agreement).id),
};

export const ADAPTERS: Record<ProviderId, EsignAdapter> = { DOCUSIGN: docusign, ADOBE: adobe };
export const isEsignProvider = (p: string): p is ProviderId => p === 'DOCUSIGN' || p === 'ADOBE';

/** Finds the envelope id in a callback body of either provider's shape. */
export const externalIdOfAny = (data: Record<string, unknown>): string | null =>
  docusign.externalIdOf(data) ?? adobe.externalIdOf(data);
