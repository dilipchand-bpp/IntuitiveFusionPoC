'use client';
import { Badge, Button, Card, Table, Td, Th } from '@if/ui';
import { has, send, useData, useRun } from '@/components/contract/b5-shared';

interface Item {
  id: string;
  source: string;
  name: string;
  sizeBytes: number;
  sha256: string;
  signature: string | null;
  status: 'QUARANTINED' | 'PENDING_SCAN' | 'CLEARED';
  createdAt: string;
  scannedAt: string | null;
  user: string | null;
}
interface View {
  simulated: boolean;
  scanner: { engine: string; mode: 'UP' | 'DOWN'; testSignatures: string[]; failClosed: string };
  items: Item[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
const TONE = { QUARANTINED: 'error', PENDING_SCAN: 'warning', CLEARED: 'success' } as const;

/** Quarantined and held uploads, the simulated scanner and its connector state (SEC-AP04). */
export function QuarantinePanel({ csrf, roles }: { csrf: string; roles: readonly string[] }) {
  const { data, error, reload } = useData<View>('/security/quarantine');
  const admin = has(roles, 'ADMIN');
  const act = useRun();
  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const setMode = (mode: 'UP' | 'DOWN') =>
    act.run(
      `mode-${mode}`,
      async () => {
        await send(csrf, 'PUT', '/admin/settings', { uploadScanning: { scannerMode: mode } });
        await reload();
      },
      mode === 'DOWN' ? 'Scanner set DOWN: new uploads are held as PENDING_SCAN.' : 'Scanner set UP.',
    );
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-xl font-bold">Scanner</h2>
          <Badge tone="info">SIMULATED: {data.scanner.engine}</Badge>
          <Badge tone={data.scanner.mode === 'UP' ? 'success' : 'error'}>
            <span data-testid="scanner-mode">{data.scanner.mode}</span>
          </Badge>
        </div>
        <p className="mt-3 max-w-prose text-sm text-text-muted">{data.scanner.failClosed}</p>
        <p className="mt-2 max-w-prose text-sm text-text-muted">
          No real malware is used. The simulated scanner flags the standard EICAR test string and the
          synthetic signature <code>IF-SIMULATED-MALWARE-TEST-SIGNATURE</code>, programs, double extensions
          and archives that contain a program.
        </p>
        {admin && (
          <div className="mt-4 flex gap-2">
            <Button
              variant="secondary"
              disabled={act.busy !== null || data.scanner.mode === 'DOWN'}
              onClick={() => void setMode('DOWN')}
            >
              Simulate scanner down
            </Button>
            <Button
              variant="secondary"
              disabled={act.busy !== null || data.scanner.mode === 'UP'}
              onClick={() => void setMode('UP')}
            >
              Bring scanner back up
            </Button>
          </div>
        )}
        {act.messages}
      </Card>
      <Card>
        <h2 className="font-heading text-xl font-bold">Quarantined and held uploads</h2>
        {data.items.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted" data-testid="quarantine-empty">
            Nothing has been quarantined or held.
          </p>
        ) : (
          <div className="mt-4">
            <Table caption="Quarantined and held uploads">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Status</Th>
                  <Th>Name</Th>
                  <Th>Where from</Th>
                  <Th>Signature</Th>
                  <Th>By</Th>
                  {admin && <Th>Action</Th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id} data-testid="quarantine-row">
                    <Td label="When">{when(i.createdAt)}</Td>
                    <Td label="Status">
                      <Badge tone={TONE[i.status]}>{i.status.replace('_', ' ')}</Badge>
                    </Td>
                    <Td label="Name">{i.name}</Td>
                    <Td label="Where from">
                      <code className="text-xs">{i.source}</code>
                    </Td>
                    <Td label="Signature">{i.signature ?? 'not scanned yet'}</Td>
                    <Td label="By">{i.user ?? 'System'}</Td>
                    {admin && (
                      <Td label="Action">
                        {i.status === 'PENDING_SCAN' ? (
                          <Button
                            variant="secondary"
                            disabled={act.busy !== null}
                            onClick={() =>
                              void act.run(
                                `rescan-${i.id}`,
                                async () => {
                                  await send(csrf, 'POST', `/security/quarantine/${i.id}/rescan`);
                                  await reload();
                                },
                                'Rescanned.',
                              )
                            }
                          >
                            Rescan {i.name}
                          </Button>
                        ) : (
                          <span className="text-sm text-text-muted">None</span>
                        )}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-text-muted">
          Content is never kept for an infected upload; held uploads are sealed until scanned.
        </p>
      </Card>
    </div>
  );
}
