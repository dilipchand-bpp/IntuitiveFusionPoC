'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

/** Legal or procurement drafts the contract for the supplier the approved report ranks first. */
export function DraftContract({
  evaluationId,
  supplierId,
  company,
  csrf,
}: {
  evaluationId: string;
  supplierId: string;
  company: string;
  csrf: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const c = await api<{ id: string }>('/contracts', {
        method: 'POST',
        csrf,
        body: { evaluationId, supplierId },
      });
      router.push(`/app/contracts/${c.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <Button loading={busy} onClick={() => void draft()} aria-label={`Draft the contract with ${company}`}>
        Draft contract
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
}
