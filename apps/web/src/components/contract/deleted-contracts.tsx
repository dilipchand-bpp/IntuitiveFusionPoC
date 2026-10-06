'use client';
import { useState } from 'react';
import { Badge, Button, EmptyState, Field, Input, Table, Td, Th } from '@if/ui';
import { aud } from '@/lib/labels';
import { send, useData, useRun } from './b5-shared';

interface Deleted {
  id: string;
  number: string;
  title: string | null;
  supplier: string;
  status: string;
  value: number;
  deletedAt: string;
  reason: string | null;
}

/** A signed contract is never destroyed. It can be taken out of view, and here it can be brought back (NFR-L04). */
export function DeletedContracts({ csrf, canRestore }: { csrf: string; canRestore: boolean }) {
  const { data, error, reload } = useData<Deleted[]>('/contracts/deleted');
  const [pick, setPick] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const r = useRun();
  if (error)
    return (
      <p role="alert" className="text-sm text-error">
        {error}
      </p>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  if (data.length === 0)
    return (
      <EmptyState
        title="Nothing has been deleted"
        body="Contracts that are removed from view appear here, with the reason."
      />
    );
  return (
    <div className="flex flex-col gap-3" data-testid="deleted-contracts">
      <Table caption="Contracts taken out of view">
        <thead>
          <tr>
            <Th>Contract</Th>
            <Th>Supplier</Th>
            <Th className="text-right">Value</Th>
            <Th>Removed</Th>
            <Th>Reason</Th>
            {canRestore && <Th>Action</Th>}
          </tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.id}>
              <Td label="Contract">
                <span className="font-mono text-xs text-text-muted">{c.number}</span> {c.title ?? ''}{' '}
                <Badge tone="neutral">{c.status.toLowerCase()}</Badge>
              </Td>
              <Td label="Supplier">{c.supplier}</Td>
              <Td label="Value" className="text-right">
                {aud.format(c.value)}
              </Td>
              <Td label="Removed" className="whitespace-nowrap">
                {new Date(c.deletedAt).toLocaleDateString('en-AU')}
              </Td>
              <Td label="Reason">{c.reason ?? '–'}</Td>
              {canRestore && (
                <Td label="Action">
                  {pick === c.id ? (
                    <form
                      className="flex flex-wrap items-end gap-2"
                      aria-label={`Bring back ${c.number}`}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void r.run(
                          'restore',
                          async () => {
                            await send(csrf, 'POST', `/contracts/${c.id}/restore`, { reason: why });
                            setPick(null);
                            setWhy('');
                            await reload();
                          },
                          'Brought back.',
                        );
                      }}
                    >
                      <Field label="Why">
                        <Input
                          value={why}
                          onChange={(e) => setWhy(e.target.value)}
                          maxLength={500}
                          className="w-56"
                        />
                      </Field>
                      <Button type="submit" loading={r.busy === 'restore'} disabled={why.trim().length < 10}>
                        Bring back
                      </Button>
                    </form>
                  ) : (
                    <Button
                      variant="secondary"
                      aria-label={`Bring back ${c.number}`}
                      onClick={() => setPick(c.id)}
                    >
                      Bring back
                    </Button>
                  )}
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
      {r.messages}
    </div>
  );
}
