'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Field, Input } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

/** A supplier is on hold because screening matched a watchlist: release it or confirm the hold, with a reason (FR-0180). */
export function SanctionsReview({ supplierId, csrf }: { supplierId: string; csrf: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'RELEASE' | 'CONFIRM') {
    setBusy(decision);
    setError(null);
    try {
      await api(`/suppliers/${supplierId}/sanctions-review`, {
        method: 'POST',
        csrf,
        body: { decision, note },
      });
      setNote('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card role="region" aria-labelledby="sanc-h" data-testid="sanctions-review">
      <h2 id="sanc-h" className="font-heading text-xl font-bold">
        Screening match: supplier on hold
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        This supplier cannot see tender documents or bid until the match is reviewed. Say what you found; the
        decision is recorded.
      </p>
      <div className="mt-3">
        <Field label="What you found" hint="At least 5 characters">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-error">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          loading={busy === 'RELEASE'}
          disabled={note.trim().length < 5}
          onClick={() => void decide('RELEASE')}
        >
          Release the hold
        </Button>
        <Button
          variant="secondary"
          loading={busy === 'CONFIRM'}
          disabled={note.trim().length < 5}
          onClick={() => void decide('CONFIRM')}
        >
          Confirm the match
        </Button>
      </div>
    </Card>
  );
}
