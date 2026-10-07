'use client';
import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Field, Input, Select, Table, Td, Textarea, Th } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

interface PathRow {
  id: string;
  purpose: string;
  purposeLabel: string;
  name: string;
  host: string | null;
  region: string;
  regionAllowed: boolean;
  egressAllowed: boolean;
  allowed: boolean;
  inUse: boolean;
  note: string | null;
}
interface Refusal {
  id: string;
  kind: 'RESIDENCY' | 'EGRESS';
  purpose: string;
  target: string;
  region: string | null;
  electedCountry: string | null;
  reason: string;
  actor: string | null;
  at: string;
}
interface View {
  model: string;
  country: string;
  allowedRegions: string[];
  permittedRegions: string[];
  aiRegion: string;
  logRegion: string;
  aiRegionAllowed: boolean;
  logRegionAllowed: boolean;
  countries: string[];
  paths: PathRow[];
  refusals: { residency: number; egress: number; total: number };
  recentRefusals: Refusal[];
  egress: { allowedHosts: string[]; evidence: string; blocked: number; recent: Refusal[] };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
const NAMES: Record<string, string> = {
  AU: 'Australia',
  NZ: 'New Zealand',
  UK: 'United Kingdom',
  EU: 'European Union',
  US: 'United States',
  CA: 'Canada',
  SG: 'Singapore',
  JP: 'Japan',
};
const nm = (c: string) => `${NAMES[c] ?? c} (${c})`;

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

function RefusalTable({ rows, caption }: { rows: Refusal[]; caption: string }) {
  if (rows.length === 0) return <p className="text-sm text-text-muted">Nothing has been refused yet.</p>;
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th>When</Th>
          <Th>Kind</Th>
          <Th>Purpose</Th>
          <Th>Target</Th>
          <Th>Region</Th>
          <Th>By</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td label="When">{when(r.at)}</Td>
            <Td label="Kind">
              <Badge tone="error">{r.kind === 'EGRESS' ? 'Egress blocked' : 'Residency refused'}</Badge>
            </Td>
            <Td label="Purpose">{r.purpose.replace(/_/g, ' ').toLowerCase()}</Td>
            <Td label="Target">{r.target}</Td>
            <Td label="Region">{r.region ?? 'n/a'}</Td>
            <Td label="By">{r.actor ?? 'System'}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** The hosting country, the outbound paths, refusals and the egress allow-list (NFR-R02, SEC-D09, SEC-D05). */
export function ResidencyPanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const { data, error, reload } = useData<View>('/admin/residency');
  const admin = has(roles, 'ADMIN');
  const change = useRun();
  const hosts = useRun();
  const probe = useRun();
  const [form, setForm] = useState<{ country: string; allowed: string[]; ai: string; log: string } | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [hostReason, setHostReason] = useState('');
  const [hostText, setHostText] = useState<string | null>(null);
  const [probeHost, setProbeHost] = useState('');
  const [probeResult, setProbeResult] = useState<string | null>(null);

  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const f = form ?? {
    country: data.country,
    allowed: data.allowedRegions,
    ai: data.aiRegion,
    log: data.logRegion,
  };
  const dirty =
    f.country !== data.country ||
    f.ai !== data.aiRegion ||
    f.log !== data.logRegion ||
    [...f.allowed].sort().join() !== [...data.allowedRegions].sort().join();
  const hostValue = hostText ?? data.egress.allowedHosts.join('\n');

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">Hosting country</h2>
          <Badge tone="info">Simulated: no real network is used ({data.model})</Badge>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Elected country" value={nm(data.country)} testid="res-country" />
          <Stat
            label="Allowed as well"
            value={data.allowedRegions.length ? data.allowedRegions.join(', ') : 'none'}
            testid="res-allowed"
          />
          <Stat label="AI region" value={data.aiRegion} testid="res-ai" />
          <Stat label="Log region" value={data.logRegion} testid="res-log" />
        </dl>
        {(!data.aiRegionAllowed || !data.logRegionAllowed) && (
          <p role="alert" className="mt-3 text-sm font-medium text-error">
            {!data.aiRegionAllowed &&
              'The AI region is not an allowed region: AI conversations cannot be stored. '}
            {!data.logRegionAllowed && 'The log region is not an allowed region: audit exports are refused.'}
          </p>
        )}
        <p className="mt-3 max-w-prose text-sm text-text-muted">
          A transfer to a region that is not the elected country or on the allow-list is refused with
          RESIDENCY_VIOLATION, audited and counted below. Changing the country switches off any connector that
          would now be outside the allowed regions; it never switches one back on.
        </p>
        {admin ? (
          <form
            className="mt-4 flex max-w-xl flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void change.run(
                'save',
                async () => {
                  await send(csrf, 'PUT', '/admin/residency', {
                    country: f.country,
                    allowedRegions: f.allowed.filter((r) => r !== f.country),
                    aiRegion: f.ai,
                    logRegion: f.log,
                    reason,
                  });
                  setForm(null);
                  setReason('');
                  await reload();
                },
                'Saved and audited.',
              );
            }}
          >
            <Field label="Hosting country">
              <Select value={f.country} onChange={(e) => setForm({ ...f, country: e.target.value })}>
                {data.countries.map((c) => (
                  <option key={c} value={c}>
                    {nm(c)}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-semibold">Other allowed regions</legend>
              <div className="flex flex-wrap gap-x-4">
                {data.countries
                  .filter((c) => c !== f.country)
                  .map((c) => (
                    <Checkbox
                      key={c}
                      label={nm(c)}
                      checked={f.allowed.includes(c)}
                      onChange={(e) =>
                        setForm({
                          ...f,
                          allowed: e.target.checked ? [...f.allowed, c] : f.allowed.filter((x) => x !== c),
                        })
                      }
                    />
                  ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="AI region" hint="Where AI processing and AI conversations are held.">
                <Select value={f.ai} onChange={(e) => setForm({ ...f, ai: e.target.value })}>
                  {data.countries.map((c) => (
                    <option key={c} value={c}>
                      {nm(c)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Log region" hint="Where logs and audit exports go.">
                <Select value={f.log} onChange={(e) => setForm({ ...f, log: e.target.value })}>
                  {data.countries.map((c) => (
                    <option key={c} value={c}>
                      {nm(c)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field
              label="Reason for the change"
              hint="At least 10 characters. It is kept in the audit trail."
              required
            >
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button
              type="submit"
              loading={change.busy === 'save'}
              disabled={!dirty || reason.trim().length < 10 || change.busy !== null}
            >
              Save residency settings
            </Button>
            {change.messages}
          </form>
        ) : (
          <p className="mt-3 text-sm text-text-muted">Only an administrator can change these settings.</p>
        )}
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">Outbound paths</h2>
        <p className="mt-1 max-w-prose text-sm text-text-muted">
          Every way data can leave the application, the region it lands in, and whether the elected country
          and the egress allow-list let it through now.
        </p>
        <div className="mt-3">
          <Table caption="Outbound paths with region and whether they are allowed">
            <thead>
              <tr>
                <Th>Path</Th>
                <Th>Purpose</Th>
                <Th>Host</Th>
                <Th>Region</Th>
                <Th>Switched on</Th>
                <Th>Allowed</Th>
              </tr>
            </thead>
            <tbody>
              {data.paths.map((p) => (
                <tr key={p.id} data-testid={`path-${p.id}`}>
                  <Td label="Path">
                    {p.name}
                    {p.note && <span className="block text-xs text-text-muted">{p.note}</span>}
                  </Td>
                  <Td label="Purpose">{p.purposeLabel}</Td>
                  <Td label="Host">{p.host ?? 'inside the application'}</Td>
                  <Td label="Region">{p.region}</Td>
                  <Td label="Switched on">{p.inUse ? 'Yes' : 'No'}</Td>
                  <Td label="Allowed">
                    {p.allowed ? (
                      <Badge tone="success">Allowed</Badge>
                    ) : (
                      <Badge tone="error">{!p.regionAllowed ? 'Blocked: region' : 'Blocked: host'}</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">Recent refusals</h2>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <Stat label="Residency refusals" value={data.refusals.residency} testid="res-count" />
          <Stat label="Egress blocks" value={data.refusals.egress} testid="egr-count" />
          <Stat label="Total" value={data.refusals.total} />
        </dl>
        <div className="mt-3">
          <RefusalTable rows={data.recentRefusals} caption="Recent refused transfers" />
        </div>
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold">Egress allow-list</h2>
        <p className="mt-2 max-w-prose text-sm" data-testid="egress-evidence">
          {data.egress.evidence}
        </p>
        <h3 className="mt-4 text-sm font-bold uppercase tracking-wide text-text-muted">Allowed hosts</h3>
        <ul className="mt-1 list-disc pl-5 text-sm" data-testid="egress-hosts">
          {data.egress.allowedHosts.map((h) => (
            <li key={h}>
              <code>{h}</code>
            </li>
          ))}
        </ul>
        {admin && (
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void hosts.run(
                  'hosts',
                  async () => {
                    await send(csrf, 'PUT', '/admin/egress', {
                      allowedHosts: hostValue
                        .split(/\r?\n/)
                        .map((x) => x.trim())
                        .filter(Boolean),
                      reason: hostReason,
                    });
                    setHostText(null);
                    setHostReason('');
                    await reload();
                  },
                  'Allow-list saved and audited.',
                );
              }}
            >
              <Field
                label="Allowed hosts, one per line"
                hint="A host name or *.wildcard.name. A wildcard needs two labels after the star."
              >
                <Textarea rows={4} value={hostValue} onChange={(e) => setHostText(e.target.value)} />
              </Field>
              <Field label="Reason for the change" required>
                <Input value={hostReason} onChange={(e) => setHostReason(e.target.value)} />
              </Field>
              <Button
                type="submit"
                loading={hosts.busy === 'hosts'}
                disabled={hostReason.trim().length < 10 || hosts.busy !== null}
              >
                Save allow-list
              </Button>
              {hosts.messages}
            </form>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setProbeResult(null);
                void probe.run('probe', async () => {
                  try {
                    await send(csrf, 'POST', '/admin/egress/probe', { host: probeHost });
                    setProbeResult(`${probeHost} is allowed.`);
                  } catch (err) {
                    await reload();
                    throw err;
                  }
                });
              }}
            >
              <Field
                label="Try a host through the gate"
                hint="A host that is not allowed is refused, audited and counted."
              >
                <Input
                  value={probeHost}
                  onChange={(e) => setProbeHost(e.target.value)}
                  placeholder="api.example.com"
                />
              </Field>
              <Button
                type="submit"
                variant="secondary"
                loading={probe.busy === 'probe'}
                disabled={!probeHost.trim() || probe.busy !== null}
              >
                Try host
              </Button>
              {probeResult && (
                <p role="status" className="text-sm font-medium text-success">
                  {probeResult}
                </p>
              )}
              {probe.messages}
            </form>
          </div>
        )}
        <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-text-muted">
          Attempts blocked ({data.egress.blocked})
        </h3>
        <div className="mt-2">
          <RefusalTable rows={data.egress.recent} caption="Blocked outbound attempts" />
        </div>
      </Card>
    </div>
  );
}
