'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Dialog, Field, Input, Select, Textarea } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

/** Legal or procurement starts an NDA, confidentiality agreement or master agreement, signed the same way as a contract (FR-0430). */
export function NewDocument({ csrf }: { csrf: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; company: string }>>([]);
  const [f, setF] = useState({ docType: 'NDA', supplierId: '', title: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && suppliers.length === 0)
      void api<Array<{ id: string; company: string }>>('/suppliers').then(setSuppliers, () => undefined);
  }, [open, suppliers.length]);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>('/contracts/documents', { method: 'POST', csrf, body: f });
      router.push(`/app/contracts/${r.id}`);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ')
          : 'Something went wrong.',
      );
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New agreement (NDA, confidentiality, master)
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New agreement"
        description="It goes through legal review and is signed by the same authorised people as a contract."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!f.supplierId || f.title.trim().length < 3 || f.text.trim().length < 20}
              onClick={() => void create()}
            >
              Create the draft
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Type of agreement">
            <Select value={f.docType} onChange={(e) => setF({ ...f, docType: e.target.value })}>
              <option value="NDA">Non-disclosure agreement</option>
              <option value="CONFIDENTIALITY">Confidentiality agreement</option>
              <option value="MASTER">Master agreement</option>
            </Select>
          </Field>
          <Field label="Counterparty">
            <Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
              <option value="">Choose a supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Wording" hint="At least 20 characters. Legal can edit it in review.">
            <Textarea rows={5} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          </Field>
          {error && (
            <p role="alert" className="text-sm font-medium text-error">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
