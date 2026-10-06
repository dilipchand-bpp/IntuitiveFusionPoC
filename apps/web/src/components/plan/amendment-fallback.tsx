'use client';
import { useMemo, useState } from 'react';
import { Button, Field, Select } from '@if/ui';
import { api } from '@/lib/api-client';
import { message } from '@/components/contract/b5-shared';
import type { PlanField } from './types';

/**
 * When the assistant cannot make an amendment on its own (NFR-U08), the person still has a way to get it done: copy the
 * section and the instruction into the AI chat they use, paste the amended text back, and save it. Or edit the section directly.
 */
export function AmendmentFallback({
  planId,
  csrf,
  fields,
  instruction,
  onSaved,
  onEdit,
}: {
  planId: string;
  csrf: string;
  fields: PlanField[];
  instruction: string;
  onSaved: () => void;
  onEdit: (key: string) => void;
}) {
  const guess = useMemo(() => {
    const t = instruction.toLowerCase();
    return fields.find((f) => t.includes(f.label.toLowerCase()))?.key ?? fields[0]?.key ?? '';
  }, [fields, instruction]);
  const [key, setKey] = useState(guess);
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = fields.find((f) => f.key === key);
  if (!field) return null;
  const prompt = `Amend this section of a procurement plan as follows: "${instruction}"\n\nSection: ${field.label}\n\n${field.value}\n\nReply with the full amended section text only.`;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/plans/${planId}/fields/${field!.key}`, {
        method: 'PUT',
        csrf,
        body: { value: pasted.trim(), expectedRev: field!.rev ?? 0 },
      });
      setPasted('');
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Another way to make this change"
      data-testid="amend-fallback"
      className="mt-3 flex flex-col gap-3 rounded-md border border-border bg-surface-alt p-3 text-sm"
    >
      <h3 className="font-heading text-base font-bold">Another way to make this change</h3>
      <Field label="Section to change">
        <Select value={key} onChange={(e) => setKey(e.target.value)}>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <p className="font-semibold">1. Copy this into your AI chat</p>
        <textarea
          readOnly
          aria-label="Text to copy"
          value={prompt}
          rows={5}
          className="mt-1 w-full rounded-md border border-border-strong bg-surface p-2 font-mono text-xs"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(prompt).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div>
        <label htmlFor="amended-text" className="font-semibold">
          2. Paste the amended text here
        </label>
        <textarea
          id="amended-text"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={5}
          className="mt-1 w-full rounded-md border border-border-strong bg-surface p-2"
        />
        <Button type="button" loading={busy} disabled={pasted.trim().length < 3} onClick={() => void save()}>
          Use this text
        </Button>
      </div>
      <p>
        Or{' '}
        <button
          type="button"
          className="font-semibold text-accent underline"
          onClick={() => onEdit(field.key)}
        >
          edit {field.label.toLowerCase()} yourself
        </button>
        .
      </p>
      {error && (
        <p role="alert" className="font-medium text-error">
          {error}
        </p>
      )}
    </section>
  );
}
