'use client';
import { useState } from 'react';
import { Badge, Button, Card, Table, Td, Th } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

interface Key {
  id: string;
  purpose: 'DATA' | 'BIDS' | 'PROJECT';
  version: number;
  state: 'ACTIVE' | 'RETIRED' | 'DISABLED';
  fingerprint: string;
  createdAt: string;
  rewrappedAt: string | null;
  usedBy: number;
}
interface View {
  simulated: boolean;
  label: string;
  rootKeySource: string;
  keys: Key[];
  purposes: Array<{ purpose: string; meaning: string }>;
}
interface Rewrap {
  purpose: string;
  toVersion: number;
  rewrapped: number;
  families: Array<{ family: string; rewrapped: number; alreadyCurrent: number; skipped: number }>;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
const TONE = { ACTIVE: 'success', RETIRED: 'neutral', DISABLED: 'error' } as const;

/** Customer-managed keys with rotation, re-wrap and disable (SEC-D02, SEC-D04). SIMULATED local key service. */
export function KeysPanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const { data, error, reload } = useData<View>('/security/keys');
  const admin = has(roles, 'ADMIN');
  const act = useRun();
  const [rewrapNote, setRewrapNote] = useState<string | null>(null);
  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const purposes = ['BIDS', 'PROJECT', 'DATA'] as const;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="info">SIMULATED key service</Badge>
          <span className="text-sm text-text-muted" data-testid="key-root">
            Root key source: {data.rootKeySource}
          </span>
        </div>
        <p className="mt-3 max-w-prose text-sm text-text-muted">
          {data.label}. Each object has its own data key, wrapped by the tenant key of its purpose. Rotating
          adds a version; older versions keep decrypting until they are disabled. Re-wrapping moves every data
          key to the newest version without touching the encrypted content.
        </p>
      </Card>
      {purposes.map((p) => {
        const rows = data.keys.filter((k) => k.purpose === p);
        const meaning = data.purposes.find((x) => x.purpose === p)?.meaning ?? '';
        return (
          <Card key={p}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-heading text-xl font-bold">{p} key</h2>
                <p className="text-sm text-text-muted">{meaning}</p>
              </div>
              {admin && (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    loading={act.busy === `rot-${p}`}
                    disabled={act.busy !== null}
                    onClick={() =>
                      void act.run(
                        `rot-${p}`,
                        async () => {
                          await send(csrf, 'POST', `/security/keys/${p}/rotate`);
                          await reload();
                        },
                        `${p} key rotated: a new version is active.`,
                      )
                    }
                  >
                    Rotate {p}
                  </Button>
                  <Button
                    variant="secondary"
                    loading={act.busy === `rew-${p}`}
                    disabled={act.busy !== null}
                    onClick={() =>
                      void act.run(`rew-${p}`, async () => {
                        const r = await send<Rewrap>(csrf, 'POST', `/security/keys/${p}/rewrap`);
                        const skipped = r.families.reduce((n, f) => n + f.skipped, 0);
                        setRewrapNote(
                          `${p}: re-wrapped ${r.rewrapped} data keys to version ${r.toVersion}; ${skipped} skipped.`,
                        );
                        await reload();
                      })
                    }
                  >
                    Re-wrap {p}
                  </Button>
                </div>
              )}
            </div>
            <div className="mt-4">
              <Table caption={`${p} key versions`}>
                <thead>
                  <tr>
                    <Th>Version</Th>
                    <Th>State</Th>
                    <Th>Fingerprint</Th>
                    <Th>Created</Th>
                    <Th>Objects protected</Th>
                    {admin && <Th>Action</Th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((k) => (
                    <tr key={k.id} data-testid={`key-${p}-${k.version}`}>
                      <Td label="Version">v{k.version}</Td>
                      <Td label="State">
                        <Badge tone={TONE[k.state]}>{k.state}</Badge>
                      </Td>
                      <Td label="Fingerprint">
                        <code>{k.fingerprint}</code>
                      </Td>
                      <Td label="Created">{when(k.createdAt)}</Td>
                      <Td label="Objects protected">{k.usedBy}</Td>
                      {admin && (
                        <Td label="Action">
                          {k.state === 'DISABLED' ? (
                            <Button
                              variant="secondary"
                              disabled={act.busy !== null}
                              onClick={() =>
                                void act.run(
                                  `en-${k.id}`,
                                  async () => {
                                    await send(csrf, 'POST', `/security/keys/${k.id}/enable`);
                                    await reload();
                                  },
                                  `${p} v${k.version} enabled again.`,
                                )
                              }
                            >
                              Enable v{k.version}
                            </Button>
                          ) : k.state === 'RETIRED' ? (
                            <Button
                              variant="secondary"
                              disabled={act.busy !== null}
                              onClick={() =>
                                void act.run(
                                  `dis-${k.id}`,
                                  async () => {
                                    await send(csrf, 'POST', `/security/keys/${k.id}/disable`);
                                    await reload();
                                  },
                                  `${p} v${k.version} disabled: what it protects will not decrypt until it is enabled.`,
                                )
                              }
                            >
                              Disable v{k.version}
                            </Button>
                          ) : (
                            <span className="text-sm text-text-muted">Rotate to retire</span>
                          )}
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        );
      })}
      {rewrapNote && (
        <p role="status" className="text-sm font-medium text-success" data-testid="rewrap-note">
          {rewrapNote}
        </p>
      )}
      {act.messages}
      {!admin && (
        <p className="text-sm text-text-muted">Only an administrator can rotate, re-wrap or disable keys.</p>
      )}
    </div>
  );
}
