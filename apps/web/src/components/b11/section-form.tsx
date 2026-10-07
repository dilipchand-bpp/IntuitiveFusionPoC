'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Field, Input } from '@if/ui';
import { send, useData, useRun } from '@/components/contract/b5-shared';

export interface FieldSpec {
  key: string;
  label: string;
  kind: 'number' | 'boolean' | 'text';
  hint?: string;
  /** A text field whose empty value is saved as null (for example "no named owner"). */
  nullable?: boolean;
}

/** A settings section edited in place, saved through the same endpoint as Administration > Settings (so it is audited the same way). */
export function SectionForm({
  section,
  title,
  intro,
  fields,
  csrf,
  canEdit,
}: {
  section: string;
  title: string;
  intro: string;
  fields: FieldSpec[];
  csrf: string;
  canEdit: boolean;
}) {
  const { data, error, reload } = useData<Record<string, Record<string, unknown>>>(
    canEdit ? '/admin/settings' : null,
  );
  const { busy, run, messages } = useRun();
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (data?.[section]) setDraft({ ...data[section] });
  }, [data, section]);
  if (!canEdit) return null;
  if (error && !data)
    return (
      <p role="alert" className="text-sm font-medium text-error">
        {error}
      </p>
    );
  if (!draft) return <p className="text-sm text-text-muted">Loading settings…</p>;
  const set = (k: string, v: unknown) => setDraft({ ...draft, [k]: v });
  return (
    <Card role="region" aria-labelledby={`${section}-h`}>
      <h2 id={`${section}-h`} className="font-heading text-xl font-bold">
        {title}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">{intro}</p>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = {};
          for (const f of fields) {
            const v = draft[f.key];
            body[f.key] =
              f.kind === 'number' ? Number(v) : f.kind === 'text' && f.nullable && v === '' ? null : v;
          }
          // fields not shown (the section has more) keep their stored value
          for (const k of Object.keys(draft)) if (!(k in body)) body[k] = draft[k];
          void run(
            `save-${section}`,
            async () => {
              await send(csrf, 'PUT', '/admin/settings', { [section]: body });
              await reload();
            },
            'Saved. The change is in the audit trail.',
          );
        }}
      >
        {fields.map((f) =>
          f.kind === 'boolean' ? (
            <div key={f.key} className="flex items-end">
              <Checkbox
                label={f.label}
                checked={Boolean(draft[f.key])}
                onChange={(e) => set(f.key, e.target.checked)}
              />
            </div>
          ) : (
            <Field key={f.key} label={f.label} {...(f.hint ? { hint: f.hint } : {})}>
              <Input
                {...(f.kind === 'number' ? { type: 'number', inputMode: 'numeric' as const } : {})}
                value={String(draft[f.key] ?? '')}
                onChange={(e) => set(f.key, e.target.value)}
              />
            </Field>
          ),
        )}
        <div className="flex items-end sm:col-span-2 lg:col-span-3">
          <Button type="submit" loading={busy === `save-${section}`} disabled={busy !== null}>
            Save settings
          </Button>
        </div>
      </form>
      {messages}
    </Card>
  );
}
