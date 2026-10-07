'use client';
import { useState } from 'react';
import { Badge, Button, Card, Table, Td, Th } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

interface Field {
  id: string;
  table: string;
  column: string;
  description: string;
  method: string;
  keyPurpose: string | null;
  encrypted: number;
  plaintext: number;
  versions: Record<string, number>;
}
interface Evidence {
  keyService: { label: string; rootKeySource: string; swapPoint: string };
  transport: {
    mode: string;
    hsts: {
      present: boolean;
      value: string | null;
      maxAgeDays: number | null;
      productionRequirementMet: boolean;
    };
    cookie: {
      httpOnly: boolean;
      sameSite: string;
      secure: boolean;
      secureRequiredHere: boolean;
      productionRequirementMet: boolean;
    };
    notEvidencedHere: string[];
  };
  fields: Field[];
  keys: Array<{ purpose: string; version: number; state: string; fingerprint: string; usedBy: number }>;
  summary: { fieldsTotal: number; encryptedRows: number; plaintextRows: number };
  isolation: { apiTest: string; liveCheck: string };
  generatedAt: string;
}
interface Isolation {
  ranAt: string;
  tablesWithTenantId: number;
  withRowLevelSecurity: number;
  applicationFilteredOnly: string[];
  rlsTables: Array<{ table: string; policies: number; foreignRowsExist: number; foreignRowsVisible: number }>;
  foreignRowsVisibleTotal: number;
  note: string;
  ok: boolean;
}

function Stat({ label, value, testid }: { label: string; value: string | number; testid?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-alt p-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-bold" data-testid={testid}>
        {value}
      </dd>
    </div>
  );
}

/** Encryption in transit and at rest, measured, and the tenant isolation check (SEC-D01, SEC-D02, NFR-R01, SEC-D10). */
export function EvidencePanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const { data, error, reload } = useData<Evidence>('/security/evidence');
  const admin = has(roles, 'ADMIN');
  const run = useRun();
  const [iso, setIso] = useState<Isolation | null>(null);
  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const t = data.transport;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">At rest</h2>
          <Badge tone="info">Measured from the database now</Badge>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Registered fields" value={data.summary.fieldsTotal} testid="ev-fields" />
          <Stat label="Encrypted rows" value={data.summary.encryptedRows} testid="ev-encrypted" />
          <Stat label="Plaintext rows" value={data.summary.plaintextRows} testid="ev-plaintext" />
          <Stat label="Root key source" value={data.keyService.rootKeySource} />
        </dl>
        <p className="mt-3 text-sm text-text-muted">
          <Badge tone="info">SIMULATED</Badge> {data.keyService.label}. Swap point:{' '}
          {data.keyService.swapPoint}.
        </p>
        <div className="mt-4">
          <Table caption="Encrypted fields registry">
            <thead>
              <tr>
                <Th>Field</Th>
                <Th>Protection</Th>
                <Th>Encrypted</Th>
                <Th>Plaintext</Th>
                <Th>Key versions</Th>
              </tr>
            </thead>
            <tbody>
              {data.fields.map((f) => (
                <tr key={f.id} data-testid="field-row">
                  <Td label="Field">
                    <div className="font-medium">
                      {f.table}.{f.column}
                    </div>
                    <div className="text-xs text-text-muted">{f.description}</div>
                  </Td>
                  <Td label="Protection">
                    {f.method}
                    {f.keyPurpose ? ` (${f.keyPurpose})` : ''}
                  </Td>
                  <Td label="Encrypted">{f.encrypted}</Td>
                  <Td label="Plaintext">
                    {f.plaintext > 0 ? <Badge tone="warning">{f.plaintext}</Badge> : f.plaintext}
                  </Td>
                  <Td label="Key versions">
                    {Object.keys(f.versions).length
                      ? Object.entries(f.versions)
                          .map(([v, n]) => `v${v}: ${n}`)
                          .join(', ')
                      : 'n/a'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        {admin && (
          <div className="mt-4">
            <Button
              variant="secondary"
              loading={run.busy === 'enc'}
              disabled={run.busy !== null}
              onClick={() =>
                void run.run(
                  'enc',
                  async () => {
                    await send(csrf, 'POST', '/security/encrypt-existing');
                    await reload();
                  },
                  'Older plaintext rows were encrypted. Running it again changes nothing.',
                )
              }
            >
              Encrypt older plaintext rows
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">In transit</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Mode" value={t.mode} testid="ev-mode" />
          <Stat
            label="HSTS"
            value={t.hsts.present ? `${t.hsts.maxAgeDays} days` : 'missing'}
            testid="ev-hsts"
          />
          <Stat label="Cookie Secure flag" value={t.cookie.secure ? 'on' : 'off'} testid="ev-secure" />
          <Stat
            label="Cookie HttpOnly, SameSite"
            value={`${t.cookie.httpOnly ? 'on' : 'off'}, ${t.cookie.sameSite}`}
          />
        </dl>
        <p className="mt-3 text-sm text-text-muted">
          {t.cookie.secureRequiredHere
            ? 'Production mode: HSTS and the Secure cookie flag are required, and they are '
            : 'Development or test mode: Secure cookies are required only in production. HSTS is sent anyway: '}
          {t.hsts.productionRequirementMet && (t.cookie.secure || !t.cookie.secureRequiredHere)
            ? 'in place.'
            : 'NOT all in place.'}
        </p>
        <h3 className="mt-4 text-sm font-bold">Not evidenced here</h3>
        <ul className="mt-1 list-disc pl-5 text-sm text-text-muted" data-testid="not-evidenced">
          {t.notEvidencedHere.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">Key versions in use</h2>
        <div className="mt-4">
          <Table caption="Key versions in use">
            <thead>
              <tr>
                <Th>Purpose</Th>
                <Th>Version</Th>
                <Th>State</Th>
                <Th>Fingerprint</Th>
                <Th>Objects</Th>
              </tr>
            </thead>
            <tbody>
              {data.keys.map((k) => (
                <tr key={`${k.purpose}-${k.version}`}>
                  <Td label="Purpose">{k.purpose}</Td>
                  <Td label="Version">v{k.version}</Td>
                  <Td label="State">{k.state}</Td>
                  <Td label="Fingerprint">
                    <code>{k.fingerprint}</code>
                  </Td>
                  <Td label="Objects">{k.usedBy}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">Data stays in the tenancy</h2>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          Every row carries its tenant. The cross-tenant test ({data.isolation.apiTest}) calls every read
          route as a user of one tenant against a populated second tenant. The live check below looks at the
          database now.
        </p>
        {admin && (
          <div className="mt-4">
            <Button
              loading={run.busy === 'iso'}
              disabled={run.busy !== null}
              onClick={() =>
                void run.run('iso', async () => {
                  setIso(await send<Isolation>(csrf, 'POST', '/security/isolation-check'));
                })
              }
            >
              Run isolation check
            </Button>
          </div>
        )}
        {run.messages}
        {iso && (
          <div className="mt-4" data-testid="isolation-result">
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Tables with a tenant" value={iso.tablesWithTenantId} />
              <Stat label="With row level security" value={iso.withRowLevelSecurity} testid="iso-rls" />
              <Stat label="Foreign rows visible" value={iso.foreignRowsVisibleTotal} testid="iso-visible" />
              <Stat label="Result" value={iso.ok ? 'Isolated' : 'LEAK'} testid="iso-ok" />
            </dl>
            <p className="mt-3 text-sm text-text-muted">{iso.note}</p>
            <p className="mt-2 text-sm text-text-muted">
              Protected by the application filter only: {iso.applicationFilteredOnly.length} tables.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
