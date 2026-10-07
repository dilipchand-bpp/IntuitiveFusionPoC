'use client';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Textarea, type BadgeTone } from '@if/ui';
import { has, send, useData, useRun } from './b5-shared';

type Level = 'SES' | 'AES' | 'QES';
interface Evidence {
  signer: string;
  method: string;
  methodLabel: string;
  level: Level;
  levelLabel: string;
  requiredLevel: Level;
  provider: string | null;
  signedAt: string;
  documentDigest: string;
  algorithm: string;
  ip: string | null;
  userAgentClass: string | null;
  integrity: 'INTACT' | 'MODIFIED_AFTER_SIGNING';
}
interface LevelCard {
  required: { level: Level; basis: 'CONTRACT_OVERRIDE' | 'VALUE_TIER' | 'DEFAULT'; detail: string };
  override: { level: Level; reason: string; setBy: string | null; setAt: string } | null;
  tiers: Array<{ fromAud: number; level: Level }>;
  defaultLevel: Level;
  explainer: Array<{ level: Level; label: string; how: string; properties: string[]; suits: string }>;
  chain: Array<{
    role: string;
    label: string;
    signed: boolean;
    level: Level | null;
    signedBy: string | null;
    evidence: Evidence | null;
  }>;
  currentDigest: string;
  integrity: 'INTACT' | 'MODIFIED_AFTER_SIGNING';
  qualifiedProviderReady: boolean;
  esignProvider: string | null;
  mfaEnrolled: boolean;
  canOverride: boolean;
}

const LEVEL_TONE: Record<Level, BadgeTone> = { SES: 'neutral', AES: 'info', QES: 'success' };
const when = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** The eIDAS level this contract needs, the level each signature reached, the evidence kept with it, and how to sign higher (NFR-L03). */
export function SignatureLevelCard({
  contractId,
  status,
  csrf,
  roles,
  canSign,
  onChange,
}: {
  contractId: string;
  status: string;
  csrf: string;
  roles: string[];
  canSign: boolean;
  /** Called after a signature or a change of level, so the page can load the contract again. */
  onChange: () => void;
}) {
  const [tick, setTick] = useState(0);
  const d = useData<LevelCard>(`/contracts/${contractId}/signature-level?s=${status}&n=${tick}`);
  const { busy, run, messages } = useRun();
  const [level, setLevel] = useState<'' | Level>('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const c = d.data;
  if (d.error && !c) return null; // a person without a contract role is not shown this card
  if (!c) return null;
  const open = ['AWAITING_SIGNATURE', 'PARTIALLY_SIGNED'].includes(status);
  const refresh = () => {
    setTick((n) => n + 1);
    onChange();
  };
  const legal = has(roles, 'LEGAL');
  return (
    <Card role="region" aria-labelledby="siglevel-h" data-testid="signature-level-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="siglevel-h" className="font-heading text-xl font-bold">
          Signature level
        </h2>
        <Badge tone={LEVEL_TONE[c.required.level]}>
          <span data-testid="required-level">Needs {c.required.level}</span>
        </Badge>
        <Badge tone="neutral">Simulated provider</Badge>
      </div>
      <p className="mt-2 text-sm text-text-muted" data-testid="required-detail">
        {c.required.detail}.
      </p>

      <ul className="mt-3 flex flex-col gap-2" data-testid="level-chain">
        {c.chain.map((s) => (
          <li key={s.role} className="rounded-md border border-border p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{s.label}</p>
              {s.evidence ? (
                <Badge tone={LEVEL_TONE[s.evidence.level]}>
                  <span data-testid="signed-level">{s.evidence.level}</span>
                </Badge>
              ) : s.signed ? (
                <Badge tone="neutral">Signed</Badge>
              ) : (
                <Badge tone="neutral">Not signed yet</Badge>
              )}
            </div>
            {s.evidence && (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-text-muted">
                <dt>Signer</dt>
                <dd>{s.evidence.signer}</dd>
                <dt>Method</dt>
                <dd>
                  {s.evidence.methodLabel}
                  {s.evidence.provider ? ` (${s.evidence.provider})` : ''}
                </dd>
                <dt>Level</dt>
                <dd>{s.evidence.levelLabel}</dd>
                <dt>Time</dt>
                <dd>{when(s.evidence.signedAt)}</dd>
                <dt>{s.evidence.algorithm}</dt>
                <dd className="break-all font-mono" title={s.evidence.documentDigest}>
                  {s.evidence.documentDigest.slice(0, 16)}…
                </dd>
                <dt>Browser</dt>
                <dd>{(s.evidence.userAgentClass ?? 'unknown').toLowerCase().replace('_', ' ')}</dd>
              </dl>
            )}
          </li>
        ))}
      </ul>

      {c.chain.some((s) => s.evidence) &&
        (c.integrity === 'MODIFIED_AFTER_SIGNING' ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-error" data-testid="integrity-modified">
            The wording or terms changed after a signature was made. The signed fingerprint no longer matches.
          </p>
        ) : (
          <p className="mt-2 text-sm text-success" data-testid="integrity-intact">
            The contract matches what was signed (document hash checked).
          </p>
        ))}
      {c.chain.some((s) => s.evidence) && (
        <p className="mt-2 text-sm">
          <a
            className="font-semibold text-accent underline"
            href={`/api/v1/contracts/${contractId}/signature-evidence`}
            download
            data-testid="evidence-export"
          >
            Download the signature evidence (JSON)
          </a>
        </p>
      )}

      {open && canSign && c.required.level !== 'SES' && (
        <form
          className="mt-4 flex flex-col gap-3 border-t border-border pt-3"
          data-testid="aes-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              'aes',
              async () => {
                await send(csrf, 'POST', `/contracts/${contractId}/sign`, {
                  decision: 'APPROVE',
                  method: 'PASSWORD_MFA',
                  password,
                  mfaCode: code,
                });
                setPassword('');
                setCode('');
                refresh();
              },
              'Signed at the advanced level.',
            );
          }}
        >
          <h3 className="font-heading text-base font-bold">
            {c.required.level === 'QES'
              ? 'Sign through the qualified provider'
              : 'Sign at the advanced level'}
          </h3>
          {c.required.level === 'QES' ? (
            <p className="text-sm text-text-muted">
              This contract needs a qualified signature.{' '}
              {c.qualifiedProviderReady
                ? 'Open the signing envelope below and sign there.'
                : 'The e-signature connector is not set to the qualified provider, so ask an administrator to change it.'}
            </p>
          ) : (
            <>
              {!c.mfaEnrolled && (
                <p className="text-sm text-warning">
                  You have no authenticator app yet. Set one up under Security first, then come back here.
                </p>
              )}
              <Field label="Your password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Code from your authenticator app" hint="Six digits.">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <div>
                <Button
                  type="submit"
                  loading={busy === 'aes'}
                  disabled={busy !== null || !password || code.length !== 6}
                >
                  Sign with password and code
                </Button>
              </div>
            </>
          )}
        </form>
      )}

      {legal && c.canOverride && (
        <form
          className="mt-4 flex flex-col gap-3 border-t border-border pt-3"
          data-testid="level-override"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              'override',
              async () => {
                await send(csrf, 'PUT', `/contracts/${contractId}/signature-level`, {
                  level: level === '' ? null : level,
                  reason,
                });
                setReason('');
                refresh();
              },
              'Saved. The level applies to the next signature.',
            );
          }}
        >
          <h3 className="font-heading text-base font-bold">Set the level for this contract</h3>
          {c.override && (
            <p className="text-sm text-text-muted" data-testid="override-note">
              Set to {c.override.level} by {c.override.setBy ?? 'Legal'}: {c.override.reason}
            </p>
          )}
          <Field label="Level">
            <Select value={level} onChange={(e) => setLevel(e.target.value as '' | Level)}>
              <option value="">Use the organisation rule</option>
              <option value="SES">SES: simple</option>
              <option value="AES">AES: advanced</option>
              <option value="QES">QES: qualified</option>
            </Select>
          </Field>
          <Field label="Reason" hint="At least 10 characters. It is kept in the audit log.">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div>
            <Button
              type="submit"
              loading={busy === 'override'}
              disabled={busy !== null || reason.trim().length < 10}
            >
              Save level
            </Button>
          </div>
        </form>
      )}
      {messages}

      <details className="mt-4 border-t border-border pt-3" data-testid="level-explainer">
        <summary className="cursor-pointer text-sm font-semibold">What the signature levels mean</summary>
        <ul className="mt-2 flex flex-col gap-3 text-sm">
          {c.explainer.map((x) => (
            <li key={x.level}>
              <p className="font-semibold">
                {x.level}: {x.label}
              </p>
              <p className="text-text-muted">{x.how}</p>
              <ul className="list-disc pl-5 text-text-muted">
                {x.properties.map((pp) => (
                  <li key={pp}>{pp}</li>
                ))}
              </ul>
              <p className="text-text-muted">Suits: {x.suits}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-muted">
          The qualified level here uses a simulated trust service provider; no real qualified certificate is
          issued.
        </p>
      </details>
    </Card>
  );
}
