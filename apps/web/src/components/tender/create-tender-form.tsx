'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Select } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { TENDER_TYPE_LABEL } from '@/lib/labels';

/** "Create tender pack" for one approved plan: pick the procurement type and who may see it. */
export function CreateTenderForm({
  requestId,
  title,
  csrf,
}: {
  requestId: string;
  title: string;
  csrf: string;
}) {
  const router = useRouter();
  const [type, setType] = useState('RFT');
  const [access, setAccess] = useState('CLOSED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const t = await api<{ id: string }>('/tenders', {
        method: 'POST',
        csrf,
        body: { requestId, type, access },
      });
      router.push(`/app/tenders/${t.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the tender pack. Please try again.');
      setBusy(false);
    }
  }
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-label={`Create tender pack for ${title}`}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Type
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(TENDER_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {k} · {v}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Who can see it
        <Select value={access} onChange={(e) => setAccess(e.target.value)}>
          <option value="CLOSED">Invited suppliers only</option>
          <option value="OPEN">Open to any registered supplier</option>
        </Select>
      </label>
      <Button type="submit" loading={busy}>
        Create tender pack
      </Button>
      {error && (
        <p role="alert" className="basis-full text-sm font-medium text-error">
          {error}
        </p>
      )}
    </form>
  );
}
