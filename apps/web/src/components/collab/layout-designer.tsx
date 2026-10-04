'use client';
import { GripVertical } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input } from '@if/ui';
import { send, useRun } from '@/components/contract/b5-shared';

export interface LayoutSectionView {
  key: string;
  label: string;
  mandatory: boolean;
  enabled: boolean;
}
export interface LayoutViewData {
  kind: 'PLAN' | 'RFX' | 'REPORT';
  name: string;
  isDefault: boolean;
  sections: LayoutSectionView[];
}

const TITLE = {
  PLAN: 'Procurement plan layout',
  RFX: 'Tender (RFx) pack layout',
  REPORT: 'Evaluation report layout',
} as const;

/** Drag sections into the order wanted, or use the buttons; optional sections can be switched off. */
export function LayoutDesigner({
  initial,
  csrf,
  canEdit,
}: {
  initial: LayoutViewData;
  csrf: string;
  canEdit: boolean;
}) {
  const [view, setView] = useState(initial);
  const [rows, setRows] = useState(initial.sections);
  const [name, setName] = useState(initial.isDefault ? `${TITLE[initial.kind]} (ours)` : initial.name);
  const [drag, setDrag] = useState<number | null>(null);
  const r = useRun();
  const dirty = JSON.stringify(rows) !== JSON.stringify(view.sections);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    setRows(next);
  };
  const load = (v: LayoutViewData) => {
    setView(v);
    setRows(v.sections);
  };
  return (
    <Card aria-labelledby={`lay-${view.kind}`} role="region" data-testid={`layout-${view.kind}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`lay-${view.kind}`} className="font-heading text-xl font-bold">
          {TITLE[view.kind]}
        </h2>
        <Badge tone={view.isDefault ? 'neutral' : 'success'}>
          {view.isDefault ? 'System default' : view.name}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-text-muted">
        {canEdit
          ? 'Drag a section to move it, or use the arrows. Switch off the sections you do not need; the required ones stay.'
          : 'The order this document follows. An administrator or procurement can change it.'}
      </p>
      <ol className="mt-3 flex flex-col gap-2" aria-label={`${TITLE[view.kind]} sections`}>
        {rows.map((s, i) => (
          <li
            key={s.key}
            draggable={canEdit}
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => canEdit && e.preventDefault()}
            onDrop={() => {
              if (drag !== null) move(drag, i);
              setDrag(null);
            }}
            className={`flex flex-wrap items-center gap-3 rounded-md border bg-surface p-2 ${drag === i ? 'border-accent' : 'border-border'} ${s.enabled ? '' : 'opacity-60'}`}
            data-section={s.key}
          >
            {canEdit && (
              <GripVertical className="size-5 shrink-0 cursor-grab text-text-muted" aria-hidden="true" />
            )}
            <span className="w-6 text-sm text-text-muted">{i + 1}</span>
            <span className="min-w-0 flex-1 font-semibold">{s.label}</span>
            {s.mandatory && <Badge tone="neutral">Required</Badge>}
            {canEdit && (
              <>
                <label className="flex min-h-[44px] items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--if-color-accent)]"
                    checked={s.enabled}
                    disabled={s.mandatory}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))
                    }
                    aria-label={`Include ${s.label}`}
                  />
                  Include
                </label>
                <Button
                  variant="secondary"
                  aria-label={`Move ${s.label} up`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  Up
                </Button>
                <Button
                  variant="secondary"
                  aria-label={`Move ${s.label} down`}
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  Down
                </Button>
              </>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Layout name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="w-72" />
          </Field>
          <Button
            loading={r.busy === 'save'}
            disabled={!dirty || name.trim().length < 2}
            onClick={() =>
              void r.run(
                'save',
                async () =>
                  load(
                    await send<LayoutViewData>(csrf, 'PUT', `/layouts/${view.kind}`, {
                      name,
                      sections: rows.map((x) => ({ key: x.key, enabled: x.enabled })),
                    }),
                  ),
                'Layout saved. New and reopened documents follow it.',
              )
            }
          >
            Save layout
          </Button>
          {!view.isDefault && (
            <Button
              variant="secondary"
              loading={r.busy === 'reset'}
              onClick={() =>
                void r.run(
                  'reset',
                  async () => load(await send<LayoutViewData>(csrf, 'DELETE', `/layouts/${view.kind}`)),
                  'Back to the system default.',
                )
              }
            >
              Use the system default
            </Button>
          )}
        </div>
      )}
      {r.messages}
    </Card>
  );
}
