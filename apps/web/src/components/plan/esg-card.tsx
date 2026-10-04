'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Field, Input } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';

export interface EsgData {
  carbonCeilingKg?: number;
  localLabourPct?: number;
  diversityOwnedTarget?: number;
  socioEconomic: string[];
  options: string[];
  locked: boolean;
}

/** ESG and social objectives (FR-0095): set against the plan, written into its ESG section, carried into the tender pack. */
export function EsgCard({
  planId,
  initial,
  csrf,
  canEdit,
}: {
  planId: string;
  initial: EsgData;
  csrf: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    carbon: initial.carbonCeilingKg?.toString() ?? '',
    labour: initial.localLabourPct?.toString() ?? '',
    diversity: initial.diversityOwnedTarget?.toString() ?? '',
    tags: new Set(initial.socioEconomic),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const editable = canEdit && !initial.locked;
  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const n = (v: string) => (v.trim() === '' ? null : Number(v));
    try {
      await api(`/plans/${planId}/esg`, {
        method: 'PUT',
        csrf,
        body: {
          carbonCeilingKg: n(f.carbon),
          localLabourPct: n(f.labour),
          diversityOwnedTarget: n(f.diversity),
          socioEconomic: [...f.tags],
        },
      });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? [e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ')
          : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card role="region" aria-labelledby="esg-h" data-testid="esg-card">
      <h2 id="esg-h" className="font-heading text-xl font-bold">
        ESG and social objectives
      </h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        These are stored against the plan, shown in the plan, and carried into the tender pack so suppliers
        see them.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Carbon ceiling (kg CO2-e)">
          <Input
            type="number"
            min={0}
            value={f.carbon}
            disabled={!editable}
            onChange={(e) => setF({ ...f, carbon: e.target.value })}
          />
        </Field>
        <Field label="Local labour content (%)">
          <Input
            type="number"
            min={0}
            max={100}
            value={f.labour}
            disabled={!editable}
            onChange={(e) => setF({ ...f, labour: e.target.value })}
          />
        </Field>
        <Field label="Diversity-owned vendor target (%)">
          <Input
            type="number"
            min={0}
            max={100}
            value={f.diversity}
            disabled={!editable}
            onChange={(e) => setF({ ...f, diversity: e.target.value })}
          />
        </Field>
      </div>
      <fieldset className="mt-3 flex flex-wrap gap-x-4">
        <legend className="text-sm font-semibold">Socio-economic tags</legend>
        {initial.options.map((o) => (
          <label key={o} className="flex min-h-[44px] items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--if-color-accent)]"
              checked={f.tags.has(o)}
              disabled={!editable}
              onChange={(e) => {
                const t = new Set(f.tags);
                if (e.target.checked) t.add(o);
                else t.delete(o);
                setF({ ...f, tags: t });
              }}
            />
            {o}
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-error">
          {error}
        </p>
      )}
      {editable ? (
        <div className="mt-3 flex items-center gap-3">
          <Button variant="secondary" loading={busy} onClick={() => void save()}>
            Record objectives
          </Button>
          {saved && (
            <span role="status" className="text-sm font-medium text-success">
              Saved
            </span>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-text-muted">
          This plan is locked, so the objectives can no longer change.
        </p>
      )}
    </Card>
  );
}
